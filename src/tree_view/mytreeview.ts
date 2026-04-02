import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as filectl from '../filectl/filectl'
import { p4helper } from '../p4v/p4helper'

type TreeNode = filectl.changelistNode | filectl.filenode

const DRAG_MIME = 'application/vnd.code.tree.checkfiles'

export class filetree implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {
    filectler: filectl.filectl
    changelist_descriptions: Map<string, string> = new Map()
    p4helperins: p4helper | undefined
    // Callback to trigger a full refresh after drag-drop
    onAfterDrop: (() => Promise<void>) | undefined

    // TreeDragAndDropController properties
    readonly dropMimeTypes: readonly string[] = [DRAG_MIME]
    readonly dragMimeTypes: readonly string[] = [DRAG_MIME]

    constructor(filectler:filectl.filectl) {
        this.filectler = filectler
    }

    getTreeItem(element: TreeNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element
    }

    getChildren(element?: TreeNode | undefined): vscode.ProviderResult<TreeNode[]> {
        if (element === undefined) {
            // Root level: return changelist nodes
            return this.filectler.get_all_changelists(this.changelist_descriptions)
        }
        if (element instanceof filectl.changelistNode) {
            // Changelist level: return file nodes
            return element.children
        }
        // File level: no children
        return []
    }

    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(descriptions?: Map<string, string>): void {
      if (descriptions) {
          this.changelist_descriptions = descriptions
      }
      this._onDidChangeTreeData.fire();
    }

    // --- Drag and Drop ---
    handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
        // Only allow dragging file nodes
        const fileNodes = source.filter((n): n is filectl.filenode => n instanceof filectl.filenode)
        if (fileNodes.length === 0) return
        // Serialize to JSON to survive DataTransfer serialization
        const data = fileNodes.map(n => ({ filepath: n.filepath, filename: n.filename, changelist: n.changelist }))
        dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(data))
    }

    async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        if (!this.p4helperins) {
            vscode.window.showErrorMessage('DnD: p4helper not initialized')
            return
        }
        const transferItem = dataTransfer.get(DRAG_MIME)
        if (!transferItem) {
            // Fallback: try to get raw value from async
            return
        }

        let draggedNodes: {filepath: string, filename: string, changelist: string}[]
        const raw = transferItem.value
        if (typeof raw === 'string') {
            // Value was serialized to string
            try {
                draggedNodes = JSON.parse(raw)
            } catch {
                vscode.window.showErrorMessage('DnD: failed to parse transfer data')
                return
            }
        } else if (Array.isArray(raw)) {
            draggedNodes = raw
        } else {
            vscode.window.showErrorMessage(`DnD: unexpected transfer type: ${typeof raw}`)
            return
        }

        if (!draggedNodes || draggedNodes.length === 0) return

        // Determine target changelist
        let targetCl: string | undefined
        if (target instanceof filectl.changelistNode) {
            targetCl = target.changelist
        } else if (target instanceof filectl.filenode) {
            targetCl = target.changelist
        }
        if (targetCl === undefined) {
            vscode.window.showErrorMessage('DnD: could not determine target changelist')
            return
        }

        // Move each file to the target changelist
        let anySuccess = false
        for (const node of draggedNodes) {
            if (node.changelist === targetCl) continue // Already in this changelist
            const ok = await this.p4helperins.reopen_changelist(node.filepath, targetCl)
            if (ok) {
                anySuccess = true
            } else {
                vscode.window.showErrorMessage(`Failed to move ${node.filename} to Change ${targetCl}`)
            }
        }

        if (anySuccess && this.onAfterDrop) {
            await this.onAfterDrop()
        }
    }
}

// File history tree view provider
export class fileHistoryTree implements vscode.TreeDataProvider<filectl.fileHistoryNode> {
    private p4helperins: p4helper
    private currentFilePath: string = ''
    private historyItems: filectl.fileHistoryNode[] = []
    treeView: vscode.TreeView<filectl.fileHistoryNode> | undefined

    constructor(p4helperins: p4helper) {
        this.p4helperins = p4helperins
    }

    getTreeItem(element: filectl.fileHistoryNode): vscode.TreeItem {
        return element
    }

    getChildren(element?: filectl.fileHistoryNode): vscode.ProviderResult<filectl.fileHistoryNode[]> {
        if (element) return []
        return this.historyItems
    }

    private _onDidChangeTreeData = new vscode.EventEmitter<filectl.fileHistoryNode | undefined | null | void>()
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event

    async showFileHistory(filepath: string) {
        this.currentFilePath = filepath
        const logs = await this.p4helperins.get_filelog(filepath)
        this.historyItems = logs.map((log, index) => {
            // Previous revision is the next item in the list (older revision)
            const prevRevision = (index < logs.length - 1) ? logs[index + 1].revision : ''
            return new filectl.fileHistoryNode(filepath, log.revision, log.changelist, log.action, log.date, log.user, log.description, prevRevision)
        })
        this._onDidChangeTreeData.fire()

        // Use description instead of title to show filename,
        // because VS Code renders view titles in uppercase via CSS.
        if (this.treeView) {
            let displayName = path.basename(filepath)
            try {
                const realPath = fs.realpathSync.native(filepath)
                displayName = path.basename(realPath)
            } catch {
                // Fallback to original
            }
            this.treeView.description = displayName
        }
    }

    clear() {
        this.currentFilePath = ''
        this.historyItems = []
        this._onDidChangeTreeData.fire()
    }

    getCurrentFilePath(): string {
        return this.currentFilePath
    }
}
