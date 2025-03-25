// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as p4helper from './p4v/p4helper';
import {filetree} from './tree_view/mytreeview';
import * as filectl from './filectl/filectl';
import * as changeEvent from './event';
import { DecorationsProvider } from './decorations'
import { xp4LogDebug, setLogLevel, xp4Log } from './output/output'
import { Console } from 'console';

// This method is called when your extension is activated
// Called very first time
export function activate(context: vscode.ExtensionContext) {
	
	// console.log('Congratulations, your extension "xp4helper" is now active!');
	xp4Log('XP4Helper from XuYao! Make it again and again!!!')

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('xp4helper.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from XP4Helper!');
	});

	let filectler = new filectl.filectl

	let p4helperins = new p4helper.p4helper(filectler)
	afterP4Init(p4helperins, filectler)

	// Register tree data provider
	let treeDataProvider = new filetree(filectler)
	vscode.window.registerTreeDataProvider(
		'checkfiles',
		treeDataProvider
	)

	// decoration provider
	const decorationProvider = new DecorationsProvider(filectler);
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(decorationProvider)
	)

	// regist commands
	context.subscriptions.concat(treeItemCommand(p4helperins, filectler, treeDataProvider, decorationProvider))

	// p4 configuration change event
	let configurationChangeE = vscode.workspace.onDidChangeConfiguration((event)=> {
		if (event.affectsConfiguration("XP4Helper.P4PORT") 
			|| event.affectsConfiguration('XP4Helper.P4USER')) {
			vscode.window.showInformationMessage('p4 configuration is changed')
			p4helperins.init_p4_env()
		} else if (event.affectsConfiguration("XP4Helper.LogLevel")) {
			const p4_configuration = vscode.workspace.getConfiguration('XP4Helper')
			let log_level = String(p4_configuration.get('LogLevel'))
			setLogLevel(log_level)
		}
	})

	let workspaceChangeE = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		p4helperins.init_p4_env()
	})

	context.subscriptions.concat(fileChangeEvent(p4helperins, filectler, treeDataProvider, decorationProvider))
	
	context.subscriptions.push(disposable, configurationChangeE, workspaceChangeE,);

	const intervalId = setInterval(() => {
		intervalRefresh(p4helperins, filectler, decorationProvider, treeDataProvider)
	}, 5000)
}

// This method is called when your extension is deactivated
export function deactivate() {}

function intervalRefresh(p4helperins: p4helper.p4helper, filectler: filectl.filectl, decorationProvider: DecorationsProvider, treeDataProvider:filetree) {
	if (!p4helperins.is_active) return
	let allFiles = filectler.add_batch_filenode(p4helperins.get_opened())
	if (allFiles.length == 0) return
	console.log("Has change")
	decorationProvider.refresh(allFiles)
	treeDataProvider.refresh()
}

function afterP4Init(p4helperins: p4helper.p4helper, filectler: filectl.filectl) {
	if (!p4helperins.is_active) return
	filectler.add_batch_filenode(p4helperins.get_opened())
	// for(let [file, update_type] of p4helperins.get_opened()) {
	// 	filectler.add_filenode(file, update_type)
	// }
}

const validFileType:Set<string> = new Set(["sh", "lua", "c", "cpp", "h", "hpp", "json", "ym", "yaml", "py", "proto", "html"])

function checkFileValid(path:string):boolean {
	return validFileType.has(p4helper.get_postfix(path))
}

function treeItemCommand(p4helperins: p4helper.p4helper, filectler:filectl.filectl, treeDataProvider:filetree, decorationProvider:DecorationsProvider):vscode.Disposable[] {
	let openFileCommand =  vscode.commands.registerCommand('xp4helper.openfile', (filenode)=>{
		const filepath = filenode.filepath
		if(!checkFileValid(filepath)) return
		switch(filenode.update_type) {
			case filectl.eupdate_type.add: {
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filepath))
			}break;
			case filectl.eupdate_type.modify: {
				const headFilePath = p4helperins.get_head(filepath)
				if(headFilePath != "") {
					vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(headFilePath), vscode.Uri.file(filepath))
				}
				else {
					vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filepath))
				}
			}break;
			case filectl.eupdate_type.delete: {
				const headFilePath = p4helperins.get_head(filepath)
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(headFilePath))
			}break;
		}
	})

	let refreshCommand = vscode.commands.registerCommand('xp4helper.refresh', ()=>{
		treeDataProvider.refresh()
		// init后需要删除
		filectler.del_all()
		afterP4Init(p4helperins, filectler)
	})

	let revertCommand = vscode.commands.registerCommand('xp4helper.revert', (filenode)=>{
		const filepath = filenode.filepath
		filectler.del_filenode(filepath, filenode.update_type)
		p4helperins.force_revert(filenode.filepath)
		treeDataProvider.refresh()
		decorationProvider.refresh([filepath])
	})

	return [openFileCommand, refreshCommand]
}

function fileChangeEvent(p4helperins:p4helper.p4helper, filectler:filectl.filectl, treeDataProvider:filetree, decorationProvider:DecorationsProvider):vscode.Disposable[] {
	/* file change event
	* del
	* change
	* add
	* rename
	*/
	let fileDeleteE = vscode.workspace.onDidDeleteFiles((event)=>{
		let hasChange:boolean = false
		let pathList:string[] = new Array()
		for(let file of event.files) {
			const fspath = file.fsPath
			if(!checkFileValid(fspath)) continue
			const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
			let oldFileNode = filectler.get_filenod(path)
			if(changeEvent.on_del(oldFileNode, p4helperins, filectler, path)) {
				hasChange = true
				pathList.push(path)
			}
		}
		if(hasChange) {
			treeDataProvider.refresh()
			decorationProvider.refresh(pathList)
		}
	})
	let fileModifyE = vscode.workspace.onDidSaveTextDocument((event)=>{
		const fspath = event.uri.fsPath
		xp4LogDebug("ModifyE %s", fspath)
		if(!checkFileValid(fspath)) return
		const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
		let oldFileNode = filectler.get_filenod(path)
		if(changeEvent.on_modify(oldFileNode, p4helperins, filectler, path)) {
			treeDataProvider.refresh()
			decorationProvider.refresh([path])
			xp4LogDebug("OnModify success %s", fspath)
		}
	})
	let fileAddE = vscode.workspace.onDidCreateFiles((event)=>{
		let hasChange:boolean = false
		let pathList:string[] = new Array()
		for(let file of event.files) {
			const fspath = file.fsPath
			xp4LogDebug("AddE %s", fspath)
			if(!checkFileValid(fspath)) continue
			const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
			let oldFileNode = filectler.get_filenod(path)
			if(changeEvent.on_add(oldFileNode, p4helperins, filectler, path)) {
				hasChange = true
				pathList.push(path)
			}
		}
		if(hasChange) {
			treeDataProvider.refresh()
			decorationProvider.refresh(pathList)
		}
	})
	let fileRenameE = vscode.workspace.onDidRenameFiles((event)=>{
		let hasChange:boolean = false
		let pathList:string[] = new Array()
		for(let file of event.files) {
			const oldFspath = file.oldUri.fsPath
			const newFspath = file.newUri.fsPath
			const isOldValid = checkFileValid(oldFspath), isNewValid = checkFileValid(newFspath)
			if(!isOldValid && !isNewValid) continue
			const oldPath = p4helper.disk_to_upper(oldFspath).replaceAll('/', '\\')
			const newPath = p4helper.disk_to_upper(newFspath).replaceAll('/', '\\')
			let oldFileNode = filectler.get_filenod(oldPath)
			if(!isNewValid) {
				if(oldFileNode !== undefined) {
					filectler.del_filenode(oldPath, oldFileNode.update_type)
					p4helperins.force_revert(oldPath)
				}
				continue
			}
			if(!isOldValid) {
				// Not be dealt with for now
				continue
			}
			if(changeEvent.on_rename(oldFileNode, p4helperins, filectler, oldPath, newPath)) {
				hasChange = true
				pathList.push(oldPath, newPath)
			}
		}
		if(hasChange) {
			treeDataProvider.refresh()
			decorationProvider.refresh(pathList)
		}
		
	})

	return [fileDeleteE, fileModifyE, fileAddE, fileRenameE]
}