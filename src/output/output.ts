import * as vscode from 'vscode';

export const output_channel = vscode.window.createOutputChannel('XP4Helper')

export function xp4Log(str:string) {
    output_channel.append(str + "\n")
    output_channel.show()
}