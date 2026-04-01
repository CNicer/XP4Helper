import * as vscode from 'vscode'
import * as filectl from '../filectl/filectl'

type TreeNode = filectl.changelistNode | filectl.filenode

export class filetree implements vscode.TreeDataProvider<TreeNode>{
    filectler: filectl.filectl
    changelist_descriptions: Map<string, string> = new Map()

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
}
