import * as vscode from 'vscode'
import * as filectl from '../filectl/filectl'

export class filetree implements vscode.TreeDataProvider<filectl.filenode>{
    filectler: filectl.filectl

    constructor(filectler:filectl.filectl) {
        this.filectler = filectler
    }

    getTreeItem(element: filectl.filenode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element
    }

    getChildren(element?: filectl.filenode | undefined): vscode.ProviderResult<filectl.filenode[]> {
        if(element == undefined)
            return this.filectler.get_all()
        return element.children
    }

    private _onDidChangeTreeData: vscode.EventEmitter<filectl.filenode | undefined | null | void> = new vscode.EventEmitter<filectl.filenode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<filectl.filenode | undefined | null | void> = this._onDidChangeTreeData.event;

    refresh(): void {
      this._onDidChangeTreeData.fire();
    }
}
