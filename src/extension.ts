// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as p4helper from './p4v/p4helper';
import {filetree, fileHistoryTree} from './tree_view/mytreeview';
import * as filectl from './filectl/filectl';
import * as changeEvent from './event';
import { DecorationsProvider } from './decorations'
import { xp4LogDebug, setLogLevel, xp4Log } from './output/output'
import { showCommitInfoInline, clearLineBlameDecoration } from './linectl/line';

const validFileType:Set<string> = new Set(["sh", "lua", "c", "cpp", "h", "hpp", "json", "ym", "yaml", "py", "proto", "html", "xml", "js"])

function checkFileValid(path:string):boolean {
	return validFileType.has(p4helper.get_postfix(path))
}

let lastLineNumber = 0
let lastFilePath = ''

function updateLogLevel() {
	const p4_configuration = vscode.workspace.getConfiguration('XP4Helper')
	let log_level = String(p4_configuration.get('LogLevel'))
	setLogLevel(log_level)
}

// Track last descriptions to detect changes
let lastDescriptionsJson = ''

function descriptionsChanged(descriptions: Map<string, string>): boolean {
	const json = JSON.stringify(Array.from(descriptions.entries()).sort())
	if (json === lastDescriptionsJson) return false
	lastDescriptionsJson = json
	return true
}

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

	// Register tree data provider with drag and drop support
	let treeDataProvider = new filetree(filectler)
	treeDataProvider.p4helperins = p4helperins
	const checkfilesTreeView = vscode.window.createTreeView('checkfiles', {
		treeDataProvider: treeDataProvider,
		dragAndDropController: treeDataProvider
	})
	context.subscriptions.push(checkfilesTreeView)

	// decoration provider
	const decorationProvider = new DecorationsProvider(filectler);
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider(decorationProvider)
	)

	// Register file history tree view (use createTreeView for focus/reveal support)
	let fileHistoryProvider = new fileHistoryTree(p4helperins)
	const fileHistoryTreeView = vscode.window.createTreeView('fileHistory', {
		treeDataProvider: fileHistoryProvider
	})
	fileHistoryProvider.treeView = fileHistoryTreeView
	context.subscriptions.push(fileHistoryTreeView)

	// Wire up drag-drop refresh callback
	treeDataProvider.onAfterDrop = async () => {
		await intervalRefreshOnce(p4helperins, filectler, decorationProvider, treeDataProvider)
	}

	// Init after providers are ready
	afterP4Init(p4helperins, filectler, treeDataProvider, decorationProvider)

	// regist commands
	context.subscriptions.concat(treeItemCommand(p4helperins, filectler, treeDataProvider, decorationProvider, fileHistoryProvider))

	// Line blame: show last commit author and date at cursor line
	let lineBlameEnabled = vscode.workspace.getConfiguration('XP4Helper').get('ShowLineBlame', false)
	let lineBlameDisposable: vscode.Disposable | undefined

	function registerLineBlame() {
		lineBlameDisposable = vscode.window.onDidChangeTextEditorSelection(async (e) => {
			const editor = e.textEditor;
			const lineNumber = editor.selection.active.line;
			const filePath = editor.document.uri.fsPath;

			let start = Date.now()

			if (lineNumber == lastLineNumber && filePath == lastFilePath) return;
			if (!checkFileValid(filePath)) return;
			
			showCommitInfoInline(p4helperins, editor, lineNumber, filePath)
			lastLineNumber = lineNumber
			lastFilePath = filePath

			xp4LogDebug("Total cost=%dms", Date.now() - start)
		})
		context.subscriptions.push(lineBlameDisposable)
	}

	function unregisterLineBlame() {
		if (lineBlameDisposable) {
			lineBlameDisposable.dispose()
			lineBlameDisposable = undefined
		}
		// Clear existing decorations
		clearLineBlameDecoration()
		lastLineNumber = -1
		lastFilePath = ''
	}

	if (lineBlameEnabled) {
		registerLineBlame()
	}

	// p4 configuration change event
	let configurationChangeE = vscode.workspace.onDidChangeConfiguration((event)=> {
		if (event.affectsConfiguration("XP4Helper.P4PORT") 
			|| event.affectsConfiguration('XP4Helper.P4USER')) {
			vscode.window.showInformationMessage('p4 configuration is changed')
			p4helperins.init_p4_env()
		} else if (event.affectsConfiguration("XP4Helper.LogLevel")) {
			updateLogLevel()
		}
		if (event.affectsConfiguration("XP4Helper.ShowLineBlame")) {
			lineBlameEnabled = vscode.workspace.getConfiguration('XP4Helper').get('ShowLineBlame', false)
			if (lineBlameEnabled) {
				registerLineBlame()
			} else {
				unregisterLineBlame()
			}
		}
	})

	let workspaceChangeE = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		p4helperins.init_p4_env()
	})

	context.subscriptions.concat(fileChangeEvent(p4helperins, filectler, treeDataProvider, decorationProvider))
	
	context.subscriptions.push(disposable, configurationChangeE, workspaceChangeE,);

	updateLogLevel()

	// Prevent overlapping interval refreshes
	let isRefreshing = false
	const intervalId = setInterval(async () => {
		if (isRefreshing) return
		isRefreshing = true
		try {
			await intervalRefresh(p4helperins, filectler, decorationProvider, treeDataProvider)
		} finally {
			isRefreshing = false
		}
	}, 5000)
}

// This method is called when your extension is deactivated
export function deactivate() {}

async function intervalRefresh(p4helperins: p4helper.p4helper, filectler: filectl.filectl, decorationProvider: DecorationsProvider, treeDataProvider:filetree) {
	if (!p4helperins.is_active) return
	const {files, descriptions, success} = await p4helperins.get_opened()
	// Skip update when p4 command failed to avoid clearing all existing file marks
	if (!success) return
	let allFiles = filectler.add_batch_filenode(files)
	if (allFiles.length > 0) {
		console.log("Has change")
		decorationProvider.refresh(allFiles)
	}
	// Only refresh tree view when descriptions or files actually changed
	if (allFiles.length > 0 || descriptionsChanged(descriptions)) {
		treeDataProvider.refresh(descriptions)
	}
}
// One-shot refresh helper for commands that change P4 state
async function intervalRefreshOnce(p4helperins: p4helper.p4helper, filectler: filectl.filectl, decorationProvider: DecorationsProvider, treeDataProvider: filetree) {
	if (!p4helperins.is_active) return
	const {files, descriptions, success} = await p4helperins.get_opened()
	if (!success) return
	let allFiles = filectler.add_batch_filenode(files)
	if (allFiles.length > 0) {
		decorationProvider.refresh(allFiles)
	}
	treeDataProvider.refresh(descriptions)
}

async function afterP4Init(p4helperins: p4helper.p4helper, filectler: filectl.filectl, treeDataProvider?: filetree, decorationProvider?: DecorationsProvider) {
	if (!p4helperins.is_active) return
	const {files, descriptions, success} = await p4helperins.get_opened()
	if (!success) return
	const changedFiles = filectler.add_batch_filenode(files)
	if (treeDataProvider) {
		treeDataProvider.refresh(descriptions)
	}
	// Refresh decorations: update current files and clear stale decorations
	if (decorationProvider) {
		if (files.size > 0) {
			const allPaths = Array.from(files.keys())
			decorationProvider.refresh(allPaths)
		}
		// Also refresh all previously marked URIs to clear decorations for submitted/reverted files
		decorationProvider.autoRefresh()
	}
}

function treeItemCommand(p4helperins: p4helper.p4helper, filectler:filectl.filectl, treeDataProvider:filetree, decorationProvider:DecorationsProvider, fileHistoryProvider:fileHistoryTree):vscode.Disposable[] {
	let openFileCommand =  vscode.commands.registerCommand('xp4helper.openfile', async (filenode)=>{
		const filepath = filenode.filepath
		if(!checkFileValid(filepath)) return
		switch(filenode.update_type) {
			case filectl.eupdate_type.add: {
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filepath))
			}break;
			case filectl.eupdate_type.modify: {
				const headFilePath = await p4helperins.get_head(filepath)
				if(headFilePath != "") {
					vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(headFilePath), vscode.Uri.file(filepath))
				}
				else {
					vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filepath))
				}
			}break;
			case filectl.eupdate_type.delete: {
				const headFilePath = await p4helperins.get_head(filepath)
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(headFilePath))
			}break;
		}
	})

	let refreshCommand = vscode.commands.registerCommand('xp4helper.refresh', async ()=>{
		treeDataProvider.refresh()
		// init后需要删除
		filectler.del_all()
		await afterP4Init(p4helperins, filectler, treeDataProvider, decorationProvider)
	})

	let revertCommand = vscode.commands.registerCommand('xp4helper.revert', async (filenode)=>{
		const filepath = filenode.filepath
		filectler.del_filenode(filepath, filenode.update_type)
		await p4helperins.force_revert(filenode.filepath)
		treeDataProvider.refresh()
		decorationProvider.refresh([filepath])
	})

	// Feature 1: Right-click context menu - P4 Checkout current file
	let checkoutCommand = vscode.commands.registerCommand('xp4helper.checkout', async (uri?: vscode.Uri) => {
		const filepath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath
		if (!filepath) {
			vscode.window.showWarningMessage('No file selected')
			return
		}
		const result = await p4helperins.checkout_file(filepath)
		if (result.success) {
			vscode.window.showInformationMessage(`Checked out: ${filepath.split('\\').pop()}`)
			// Refresh tree and decorations
			await intervalRefreshOnce(p4helperins, filectler, decorationProvider, treeDataProvider)
		} else {
			vscode.window.showErrorMessage(`Checkout failed: ${result.message}`)
		}
	})

	// Feature 1: Right-click context menu - P4 Revert current file
	let revertFileCommand = vscode.commands.registerCommand('xp4helper.revertFile', async (uri?: vscode.Uri) => {
		const filepath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath
		if (!filepath) {
			vscode.window.showWarningMessage('No file selected')
			return
		}
		const confirm = await vscode.window.showWarningMessage(
			`Revert ${filepath.split('\\').pop()}?`,
			{ modal: true }, 'Revert'
		)
		if (confirm !== 'Revert') return
		const path = p4helper.disk_to_upper(filepath).replaceAll('/', '\\')
		const node = filectler.get_filenod(path)
		if (node) {
			filectler.del_filenode(path, node.update_type)
		}
		await p4helperins.force_revert(filepath)
		treeDataProvider.refresh()
		decorationProvider.refresh([path])
	})

	// Feature 1: Right-click context menu - P4 Diff with Head
	let diffHeadCommand = vscode.commands.registerCommand('xp4helper.diffHead', async (uri?: vscode.Uri) => {
		const filepath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath
		if (!filepath) {
			vscode.window.showWarningMessage('No file selected')
			return
		}
		const headFilePath = await p4helperins.diff_with_head(filepath)
		if (headFilePath) {
			vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(headFilePath), vscode.Uri.file(filepath), `Head ↔ ${filepath.split('\\').pop()}`)
		} else {
			vscode.window.showWarningMessage('Cannot get head revision')
		}
	})

	// Feature 2: Move file to another changelist
	let moveToChangelistCommand = vscode.commands.registerCommand('xp4helper.moveToChangelist', async (filenode: filectl.filenode) => {
		if (!filenode || !filenode.filepath) return
		const changelists = await p4helperins.get_pending_changelists()
		const items = changelists.map(cl => ({
			label: cl.changelist === 'default' ? 'default' : `Change ${cl.changelist}`,
			description: cl.description,
			changelist: cl.changelist
		}))
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select target changelist'
		})
		if (!selected) return
		const success = await p4helperins.reopen_changelist(filenode.filepath, selected.changelist)
		if (success) {
			vscode.window.showInformationMessage(`Moved to ${selected.label}`)
			await intervalRefreshOnce(p4helperins, filectler, decorationProvider, treeDataProvider)
		} else {
			vscode.window.showErrorMessage('Move failed')
		}
	})

	// Feature 3: Create new changelist
	let newChangelistCommand = vscode.commands.registerCommand('xp4helper.newChangelist', async () => {
		const description = await vscode.window.showInputBox({
			prompt: 'Enter changelist description',
			placeHolder: 'New changelist description...'
		})
		if (!description) return
		const cl = await p4helperins.create_changelist(description)
		if (cl) {
			vscode.window.showInformationMessage(`Created changelist ${cl}`)
			await intervalRefreshOnce(p4helperins, filectler, decorationProvider, treeDataProvider)
		} else {
			vscode.window.showErrorMessage('Failed to create changelist')
		}
	})

	// Feature 5: Show file history
	let fileHistoryCommand = vscode.commands.registerCommand('xp4helper.fileHistory', async (uri?: vscode.Uri) => {
		const filepath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath
		if (!filepath) {
			vscode.window.showWarningMessage('No file selected')
			return
		}
		// Focus the file history view in the sidebar first, then load data
		await vscode.commands.executeCommand('fileHistory.focus')
		await fileHistoryProvider.showFileHistory(filepath)
	})

	// Feature 5: Diff between two revisions when clicking a file history entry
	let diffRevisionCommand = vscode.commands.registerCommand('xp4helper.diffRevision', async (historyNode: filectl.fileHistoryNode, prevRevision: string) => {
		if (!historyNode) return
		const filepath = historyNode.filepath
		const currentRev = historyNode.revision

		if (historyNode.action.includes('add') && !prevRevision) {
			// First add: just open the file at that revision
			const revFile = await p4helperins.get_revision(filepath, currentRev)
			if (revFile) {
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(revFile))
			}
			return
		}

		if (!prevRevision) {
			// Oldest revision with no previous: just open it
			const revFile = await p4helperins.get_revision(filepath, currentRev)
			if (revFile) {
				vscode.commands.executeCommand('vscode.open', vscode.Uri.file(revFile))
			}
			return
		}

		// Diff prevRevision vs currentRevision
		const [prevFile, curFile] = await Promise.all([
			p4helperins.get_revision(filepath, prevRevision),
			p4helperins.get_revision(filepath, currentRev)
		])
		if (prevFile && curFile) {
			const filename = filepath.split('\\').pop() || filepath
			vscode.commands.executeCommand('vscode.diff',
				vscode.Uri.file(prevFile),
				vscode.Uri.file(curFile),
				`${filename} #${prevRevision} ↔ #${currentRev}`
			)
		}
	})

	// Feature 6: Submit changelist
	let submitChangelistCommand = vscode.commands.registerCommand('xp4helper.submitChangelist', async (clNode: filectl.changelistNode) => {
		if (!clNode || !clNode.changelist) return
		const displayName = clNode.changelist === 'default' ? 'default changelist' : `Change ${clNode.changelist}`
		const confirm = await vscode.window.showWarningMessage(
			`Submit ${displayName}?`,
			{ modal: true }, 'Submit'
		)
		if (confirm !== 'Submit') return
		const result = await p4helperins.submit_changelist(clNode.changelist)
		if (result.success) {
			vscode.window.showInformationMessage(`Submitted ${displayName} successfully`)
			// Refresh everything
			filectler.del_all()
			await afterP4Init(p4helperins, filectler, treeDataProvider, decorationProvider)
		} else {
			vscode.window.showErrorMessage(`Submit failed: ${result.message}`)
		}
	})

	return [openFileCommand, refreshCommand, revertCommand, checkoutCommand, revertFileCommand, diffHeadCommand, moveToChangelistCommand, newChangelistCommand, fileHistoryCommand, diffRevisionCommand, submitChangelistCommand]
}

function fileChangeEvent(p4helperins:p4helper.p4helper, filectler:filectl.filectl, treeDataProvider:filetree, decorationProvider:DecorationsProvider):vscode.Disposable[] {
	/* file change event
	* del
	* change
	* add
	* rename
	*/
	let fileDeleteE = vscode.workspace.onDidDeleteFiles(async (event)=>{
		let hasChange:boolean = false
		let pathList:string[] = new Array()
		for(let file of event.files) {
			const fspath = file.fsPath
			if(!checkFileValid(fspath)) continue
			const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
			let oldFileNode = filectler.get_filenod(path)
			if(await changeEvent.on_del(oldFileNode, p4helperins, filectler, path)) {
				hasChange = true
				pathList.push(path)
			}
		}
		if(hasChange) {
			treeDataProvider.refresh()
			decorationProvider.refresh(pathList)
		}
	})
	let fileModifyE = vscode.workspace.onDidSaveTextDocument(async (event)=>{
		const fspath = event.uri.fsPath
		xp4LogDebug("ModifyE %s", fspath)
		if(!checkFileValid(fspath)) return
		const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
		// Invalidate annotate cache on file save
		p4helperins.invalidateAnnotateCache(path)
		let oldFileNode = filectler.get_filenod(path)
		if(await changeEvent.on_modify(oldFileNode, p4helperins, filectler, path)) {
			treeDataProvider.refresh()
			decorationProvider.refresh([path])
			xp4LogDebug("OnModify success %s", fspath)
		}
	})
	let fileAddE = vscode.workspace.onDidCreateFiles(async (event)=>{
		let hasChange:boolean = false
		let pathList:string[] = new Array()
		for(let file of event.files) {
			const fspath = file.fsPath
			xp4LogDebug("AddE %s", fspath)
			if(!checkFileValid(fspath)) continue
			const path = p4helper.disk_to_upper(fspath).replaceAll('/', '\\')
			let oldFileNode = filectler.get_filenod(path)
			if(await changeEvent.on_add(oldFileNode, p4helperins, filectler, path)) {
				hasChange = true
				pathList.push(path)
			}
		}
		if(hasChange) {
			treeDataProvider.refresh()
			decorationProvider.refresh(pathList)
		}
	})
	let fileRenameE = vscode.workspace.onDidRenameFiles(async (event)=>{
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
					await p4helperins.force_revert(oldPath)
				}
				continue
			}
			if(!isOldValid) {
				// Not be dealt with for now
				continue
			}
			if(await changeEvent.on_rename(oldFileNode, p4helperins, filectler, oldPath, newPath)) {
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