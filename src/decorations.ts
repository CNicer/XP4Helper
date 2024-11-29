import * as vscode from "vscode";
import { filectl, eupdate_type } from './filectl/filectl'
import { disk_to_upper } from './p4v/p4helper'

export class DecorationsProvider implements vscode.FileDecorationProvider {
    protected _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    filectler: filectl
    
    markedUris: vscode.Uri[]

    constructor(filectler:filectl) {
        this.filectler = filectler
        this.markedUris = new Array
    }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        const filepath = disk_to_upper(uri.fsPath).replaceAll('/', '\\')
        const node =this.filectler.get_filenod(filepath)
        if (node === undefined) return
        let badges:string
        let colors:string
        let status:string
        switch(node.update_type) {
            case eupdate_type.add: badges = "A"; colors = "terminal.ansiGreen"; status = "Add"; this.markedUris.push(uri);  break;
            case eupdate_type.delete: badges = "D"; colors = "terminal.ansiRed"; status = "Delete"; this.markedUris.push(uri); break;
            case eupdate_type.modify: badges = "M"; colors = "terminal.ansiYellow"; status = "Modify"; this.markedUris.push(uri); break;
            default: return
        }
        return {
            badge: badges,
            tooltip: status,
            propagate: true,
            color: new vscode.ThemeColor(colors)
        }
    }

    refresh(paths:string[]) {
        let uris:vscode.Uri[] = new Array
        for(const path of paths) {
            uris.push(vscode.Uri.file(path))
        }
        this._onDidChangeFileDecorations.fire(uris)
    }

    autoRefresh() {
        this._onDidChangeFileDecorations.fire(this.markedUris)
    }
}