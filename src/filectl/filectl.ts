import * as vscode from 'vscode'

export enum eupdate_type {
    modify,
    delete,
    add,
    rename,
    unkonwn
}

// Represents a changelist node in the tree view
export class changelistNode extends vscode.TreeItem {
    changelist: string
    children: filenode[] = new Array()

    constructor(changelist: string, clDescription: string = '') {
        const displayName = changelist === 'default' ? 'default' : `Change ${changelist}`
        super(displayName, vscode.TreeItemCollapsibleState.Expanded)
        this.changelist = changelist
        this.contextValue = 'changelist'
        this.iconPath = new vscode.ThemeIcon('list-tree')
        if (clDescription) {
            this.tooltip = clDescription
        }
    }
}

export class filenode extends vscode.TreeItem{
    filename: string = ""
    filepath: string = ""
    oldpath: string = ""
    update_type: eupdate_type = eupdate_type.unkonwn
    changelist: string = "default"
    children: filenode[] = new Array()

    constructor(
        public readonly label: string,
        public readonly path: string,
        update_type: eupdate_type,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        changelist: string = "default"
    ) {
        const uri = vscode.Uri.file(path)
        super(uri, collapsibleState)
        this.filename = label
        this.filepath = path
        this.update_type = update_type
        this.changelist = changelist

        this.contextValue = 'filenode'
        this.command = {
            title: '',
            command: 'xp4helper.openfile',
            arguments: [this]
        }

        let last_third_pos:number = -1
        let last_second_found:boolean = false
        let last_pos:number = -1
        for(let i = path.length - 1; i >= 0; i--) {
            if(path[i] == '\\') {
                if(last_pos == -1) {
                    last_pos = i
                }else if(!last_second_found) {
                    last_second_found = true
                }else if(last_third_pos == -1) {
                    last_third_pos = i
                    break
                }
            }
        }

        this.description = path.substring(last_third_pos, last_pos)
    }
}

// Info structure for opened file
export interface OpenedFileInfo {
    update_type: eupdate_type
    changelist: string
}

// Represents a file history entry in the file history tree view
export class fileHistoryNode extends vscode.TreeItem {
    revision: string
    changelist: string
    action: string
    date: string
    user: string
    desc: string
    filepath: string

    constructor(filepath: string, revision: string, changelist: string, action: string, date: string, user: string, description: string, prevRevision: string = '') {
        const label = `#${revision} ${action}`
        super(label, vscode.TreeItemCollapsibleState.None)
        this.revision = revision
        this.changelist = changelist
        this.action = action
        this.date = date
        this.user = user
        this.desc = description
        this.filepath = filepath
        this.description = `${user} | ${date}`
        this.tooltip = `Change ${changelist}: ${description}`
        this.contextValue = 'fileHistory'
        this.iconPath = this._getIcon(action)

        // Click to diff this revision with previous revision
        this.command = {
            title: 'Diff Revisions',
            command: 'xp4helper.diffRevision',
            arguments: [this, prevRevision]
        }
    }

    private _getIcon(action: string): vscode.ThemeIcon {
        if (action.includes('edit')) return new vscode.ThemeIcon('edit', new vscode.ThemeColor('terminal.ansiYellow'))
        if (action.includes('add')) return new vscode.ThemeIcon('add', new vscode.ThemeColor('terminal.ansiGreen'))
        if (action.includes('delete')) return new vscode.ThemeIcon('trash', new vscode.ThemeColor('terminal.ansiRed'))
        if (action.includes('integrate') || action.includes('merge')) return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('terminal.ansiBlue'))
        if (action.includes('branch')) return new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('terminal.ansiCyan'))
        return new vscode.ThemeIcon('circle-outline')
    }
}

type NMap = Map<string, filenode>

export class filectl {
    private root: Map<eupdate_type, NMap> = new Map([
        [eupdate_type.modify, new Map<string, filenode>()],
        [eupdate_type.add, new Map<string, filenode>()],
        [eupdate_type.delete, new Map<string, filenode>()],
        [eupdate_type.rename, new Map<string, filenode>()]
    ])

    private path_type_A: Map<string, eupdate_type> = new Map
    private path_type_B: Map<string, eupdate_type> = new Map
    private path_type_old = this.path_type_A
    private path_type_new = this.path_type_B

    // Get all changelist nodes with their children for tree view
    get_all_changelists(descriptions: Map<string, string> = new Map()): changelistNode[] {
        const clMap = new Map<string, changelistNode>()
        
        for (const [_type, nmap] of this.root) {
            for (const [_path, node] of nmap) {
                const cl = node.changelist
                if (!clMap.has(cl)) {
                    const desc = descriptions.get(cl) || ''
                    clMap.set(cl, new changelistNode(cl, desc))
                }
                clMap.get(cl)!.children.push(node)
            }
        }

        // Also add empty pending changelists (from descriptions but not yet in clMap)
        for (const [cl, desc] of descriptions) {
            if (!clMap.has(cl)) {
                clMap.set(cl, new changelistNode(cl, desc))
            }
        }

        // Sort: 'default' first, then by changelist number
        const result = Array.from(clMap.values())
        result.sort((a, b) => {
            if (a.changelist === 'default') return -1
            if (b.changelist === 'default') return 1
            return parseInt(a.changelist) - parseInt(b.changelist)
        })

        // Update description with changelist desc + file count
        for (const cl of result) {
            const desc = descriptions.get(cl.changelist) || ''
            const count = cl.children.length
            const countStr = count > 0 ? `${count} file(s)` : 'empty'

            // Truncate long descriptions for sidebar display
            const maxDescLen = 40
            const shortDesc = desc.length > maxDescLen ? desc.substring(0, maxDescLen) + '...' : desc

            if (shortDesc) {
                cl.description = count > 0 ? `${shortDesc} (${countStr})` : shortDesc
            } else {
                cl.description = countStr
            }

            // Full description in tooltip (visible on hover)
            if (desc) {
                cl.tooltip = `${desc}\n${countStr}`
            } else {
                cl.tooltip = countStr
            }
        }

        return result
    }

    get_all(): filenode[] {
        return [...this.root.get(eupdate_type.modify)!.values(),
             ...this.root.get(eupdate_type.add)!.values(),
             ...this.root.get(eupdate_type.delete)!.values(),
             ...this.root.get(eupdate_type.rename)!.values()]
    }

    private _filename(path:string):string {
        const pos = path.lastIndexOf('\\')
        return path.slice(pos+1)
    }

    add_filenode(path:string, update_type:eupdate_type, oldpath:string = "", changelist:string = "default"): void {
        const filename = this._filename(path)

        if (this.root.get(update_type)!.has(path)) {
            // Update changelist if file already exists
            const existing = this.root.get(update_type)!.get(path)!
            existing.changelist = changelist
            return
        }

        let newnode:filenode|undefined
        this.root.forEach((value, key)=>{
            if (key != update_type && value.has(path)) {
                newnode = value.get(path)!
                value.delete(path)
            }
        })

        if(newnode === undefined) {
            newnode = new filenode(filename, path, update_type, vscode.TreeItemCollapsibleState.None, changelist)
        }
        else {
            newnode.update_type = update_type
            newnode.changelist = changelist
        }
        
        this.root.get(update_type)!.set(path, newnode)
        this.path_type_old.set(path, update_type)
    }

    add_batch_filenode(file_infos: Map<string, OpenedFileInfo>):string[] {
        if(this.path_type_A.size == 0) {
            this.path_type_old = this.path_type_B
            this.path_type_new = this.path_type_A
        } else {
            this.path_type_old = this.path_type_A
            this.path_type_new = this.path_type_B
        }
        
        let changed_files: string[] = new Array

        file_infos.forEach((info, file) => {
            if (!this.path_type_old.has(file) || this.path_type_old.get(file) != info.update_type) {
                changed_files.push(file)
                this.add_filenode(file, info.update_type, "", info.changelist)
            } else {
                // Even if type hasn't changed, update changelist
                const existing = this.get_filenod(file)
                if (existing) {
                    existing.changelist = info.changelist
                }
            }
            this.path_type_new.set(file, info.update_type)
            this.path_type_old.delete(file)
        })

        this.clear_old(changed_files)

        let temp = this.path_type_new
        this.path_type_new = this.path_type_old
        this.path_type_old = temp

        return changed_files
    }

    clear_old(changed_files:string[]) {
        this.path_type_old.forEach((update_type, file) => {
            this.root.get(update_type)!.delete(file)
            changed_files.push(file)
        })
        this.path_type_old.clear()
    }

    get_filenod(path:string):filenode|undefined {
        for(const [key, value] of this.root) {
            if(value.has(path)) return value.get(path)
        }
        
        return
    }
    
    del_filenode(path:string, update_type:eupdate_type|undefined) {
        if (update_type === undefined) {
            this.root.get(eupdate_type.modify)!.delete(path)
            this.root.get(eupdate_type.add)!.delete(path)
            this.root.get(eupdate_type.delete)!.delete(path)
            this.root.get(eupdate_type.rename)!.delete(path)
        }
        else {
            this.root.get(update_type)!.delete(path)
        }
    }

    del_all() {
        this.root.get(eupdate_type.modify)!.clear()
        this.root.get(eupdate_type.add)!.clear()
        this.root.get(eupdate_type.delete)!.clear()
        this.root.get(eupdate_type.rename)!.clear()
        this.path_type_A.clear()
        this.path_type_B.clear()
    }

    mv_filenode(path:string, src_update_type:eupdate_type, dst_update_type:eupdate_type) {
        let old_filenode = this.root.get(src_update_type)!.get(path)!
        old_filenode.update_type = dst_update_type
        this.root.get(dst_update_type)!.set(path, old_filenode)
    }
}
