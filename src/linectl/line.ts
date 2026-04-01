import * as vscode from 'vscode';
import { p4helper } from '../p4v/p4helper';
import { xp4LogDebug } from '../output/output';

// Reuse a single decoration type to avoid frequent create/dispose
let decorationType: vscode.TextEditorDecorationType | null = null;

function getOrCreateDecorationType(): vscode.TextEditorDecorationType {
    if (!decorationType) {
        decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: 'rgba(255, 255, 255, 0.5)',
                fontStyle: 'italic',
                margin: '0 0 0 50px',
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
            }
        });
    }
    return decorationType;
}

export function clearLineBlameDecoration() {
    if (decorationType) {
        decorationType.dispose()
        decorationType = null
    }
}

function updateDecoration(editor: vscode.TextEditor, lineNumber: number, commitInfo: { author: string, date: string }) {
    const line = editor.document.lineAt(lineNumber);
    const range = new vscode.Range(lineNumber, line.text.length, lineNumber, 0);
    const text = `-- ${commitInfo.author} ${commitInfo.date}`;

    const decType = getOrCreateDecorationType();
    
    // Update decoration content via renderOptions
    editor.setDecorations(decType, [{
        range: range,
        renderOptions: {
            after: {
                contentText: text,
            }
        }
    }]);
}

export async function showCommitInfoInline(p4helperins: p4helper, editor: vscode.TextEditor, lineNumber: number, filepath: string) {
    if (!editor) {
        xp4LogDebug("No editor is active.");
        return;
    }

    if (lineNumber === -1) {
        xp4LogDebug("No line selected.");
        return;
    }

    // Get commit info
    try {
        const commitInfo = await p4helperins.get_commit_author(filepath, lineNumber);
        updateDecoration(editor, lineNumber, commitInfo);
    } catch (error) {
        xp4LogDebug(`Failed to get commit info: ${error}`);
    }
}