import * as vscode from 'vscode'

export enum eupdate_type {
    modify,
    delete,
    add,
    rename,
    unkonwn
}

export class filenode extends vscode.TreeItem{
    filename: string = ""
    filepath: string = ""
    oldpath: string = ""
    update_type: eupdate_type = eupdate_type.unkonwn
    children: filenode[] = new Array()

    constructor(
        public readonly label: string,
        public readonly path: string,
        update_type: eupdate_type,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        const uri = vscode.Uri.file(path)
        super(uri, collapsibleState)
        this.filename = label
        this.filepath = path
        this.update_type = update_type

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

type NMap = Map<string, filenode>

export class filectl {
    private root: Map<eupdate_type, NMap> = new Map([
        [eupdate_type.modify, new Map<string, filenode>()],
        [eupdate_type.add, new Map<string, filenode>()],
        [eupdate_type.delete, new Map<string, filenode>()],
        [eupdate_type.rename, new Map<string, filenode>()]
    ])

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

    add_filenode(path:string, update_type:eupdate_type, oldpath:string = ""): void {
        const filename = this._filename(path)

        if (this.root.get(update_type)!.has(path)) return;

        let newnode:filenode|undefined
        this.root.forEach((value, key)=>{
            if (key != update_type && value.has(path)) {
                newnode = value.get(path)!
            }
        })

        if(newnode === undefined) {
            newnode = new filenode(filename, path, update_type, vscode.TreeItemCollapsibleState.None)
        }
        else {
            newnode.update_type = update_type
        }
        
        this.root.get(update_type)!.set(path, newnode)
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
    }

    mv_filenode(path:string, src_update_type:eupdate_type, dst_update_type:eupdate_type) {
        let old_filenode = this.root.get(src_update_type)!.get(path)!
        old_filenode.update_type = dst_update_type
        this.root.get(dst_update_type)!.set(path, old_filenode)
    }
}
