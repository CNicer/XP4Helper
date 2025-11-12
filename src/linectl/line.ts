import * as vscode from 'vscode';
import { p4helper } from '../p4v/p4helper';
import { xp4LogDebug } from '../output/output';

let decorationType: vscode.TextEditorDecorationType | null = null;

function createDecoration() {

}

function updateDecoration(editor: vscode.TextEditor, lineNumber: number, commitInfo: { author: string, date: string }) {
    const line = editor.document.lineAt(lineNumber); // 获取指定行
    const range = new vscode.Range(lineNumber, line.text.length, lineNumber, 0); // 获取光标所在行的范围
    const text = `-- ${commitInfo.author} ${commitInfo.date}`;

    if (decorationType) {
        decorationType.dispose()
    }

    decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: text,
            color: 'rgba(255, 255, 255, 0.5)', // 半透明白色文字
            fontStyle: 'italic', // 斜体
            margin: '0 0 0 50px', // 左边距
            backgroundColor: 'rgba(0, 0, 0, 0.1)', // 半透明背景
        }
    });
    
    // 更新装饰的内容
    editor.setDecorations(decorationType, [{
        range: range,
        renderOptions: {
            after: {
                contentText: text, // 设置提交人和日期显示的文本
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

    // 获取提交信息
    try {
        const commitInfo = await p4helperins.get_commit_author(filepath, lineNumber);
        createDecoration(); // 创建装饰
        updateDecoration(editor, lineNumber, commitInfo); // 更新装饰
    } catch (error) {
        xp4LogDebug(`Failed to get commit info: ${error}`);
    }
}