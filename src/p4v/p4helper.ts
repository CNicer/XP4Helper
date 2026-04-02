import * as vscode from 'vscode'
import {exec, spawnSync} from 'child_process'
import * as filectl from '../filectl/filectl'
import { xp4LogDebug, xp4LogError, xp4LogInfo, xp4LogWarn } from '../output/output'

// @ts-ignore
import * as P4 from 'p4js';


/*
* 在helper中所有路径用
* disk大写
* 使用/
*/

export enum echeck_res_type {
    not_in_stream,
    not_active,
    nothing_change,
    check_conflict,
    success,
}

// Sync version: only used during init_p4_env (startup, blocking is acceptable)
function exec_cmd(cmd:string):string[] {
    const result = spawnSync(cmd, [], {shell:true, encoding:'utf-8'})
    return [result.stdout.replaceAll('\r\n', '\n'), result.stderr.replaceAll('\r\n', '\n')]
}

// Async version: used for all runtime p4 commands to avoid blocking the main thread
function exec_cmd_async(cmd:string):Promise<string[]> {
    return new Promise((resolve) => {
        exec(cmd, {encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024}, (error, stdout, stderr) => {
            resolve([
                (stdout || '').replaceAll('\r\n', '\n'),
                (stderr || '').replaceAll('\r\n', '\n')
            ])
        })
    })
}

// change lower disk case to upper: g:/ -> G:/
export function disk_to_upper(path: string): string {
    if (path.length == 0) return ""
    const chars = path.split('')
    chars[0] = chars[0].toUpperCase()
    return chars.join('').replaceAll('\\', '/')
}

function get_pre_dir(path:string): string {
    const pos = path.lastIndexOf('/')
    return path.substring(0, pos)
}

function get_filename(path:string):string {
    const pos = path.lastIndexOf('\\')
    return path.substring(pos+1)
}

export function get_postfix(path:string):string {
    const pos = path.lastIndexOf('.')
    if(pos == -1) return ""
    return path.substring(pos+1)
}

// Annotate cache entry
interface AnnotateCacheEntry {
    // Map from changelist number to {author, date}
    changelistInfo: Map<string, {author: string, date: string}>
    // Array of changelist numbers per line (0-based index)
    lineChangelists: string[]
    timestamp: number
}

export class p4helper {
    p4port: string = ""
    p4user: string = ""
    p4client: string = ""
    p4stream: string = ""
    localpath: string = ""

    tempdirpath: string = process.env.TEMP + '\\xp4helper'

    is_active: boolean = false

    all_clients: Map<string, string> = new Map()

    filectler: filectl.filectl

    // Annotate cache: keyed by file path, caches annotate results
    private annotateCache: Map<string, AnnotateCacheEntry> = new Map()
    private static ANNOTATE_CACHE_TTL = 60000 // 60 seconds TTL

    constructor(filectler: filectl.filectl) {
        this.filectler = filectler
        this.init_p4_env()
    }

    // Invalidate annotate cache for a specific file (call on file save)
    invalidateAnnotateCache(path: string) {
        const normalized = path.replaceAll('\\', '/')
        this.annotateCache.delete(normalized)
    }

    // Clear all annotate cache
    clearAnnotateCache() {
        this.annotateCache.clear()
    }

    init_p4_env():void {
        process.env.P4CHARSET = 'utf8'

        // const env_p4port = process.env.P4PORT
        // const env_p4user = process.env.P4USER
        // if (env_p4port && env_p4user) {
        //     this.p4port = env_p4port
        //     process.env.P4PORT = this.p4port
        //     this.p4user = this.get_user()
        //     process.env.P4USER = this.p4user
        // }
        // else{
        //     const p4_configuration = vscode.workspace.getConfiguration('XP4Helper')
        //     this.p4port = String(p4_configuration.get('P4PORT'))
        //     if (this.p4port == "") {
        //         // console.log("p4 port is empty")
        //         xp4Log("p4 port is empty")
        //         return
        //     };
        //     process.env.P4PORT = this.p4port
        //     this.p4user = String(p4_configuration.get('P4USER'))
        //     if (this.p4user == "") {
        //         // console.log("P4 user is empty")
        //         xp4Log("p4 user is empty")
        //         return
        //     };
        // }
        const p4_configuration = vscode.workspace.getConfiguration('XP4Helper')
        this.p4port = String(p4_configuration.get('P4PORT'))
        if (this.p4port == "") {
            // console.log("p4 port is empty")
            xp4LogError("p4 port is empty")
            return
        };
        process.env.P4PORT = this.p4port
        this.p4user = String(p4_configuration.get('P4USER'))
        if (this.p4user == "") {
            // console.log("P4 user is empty")
            xp4LogError("p4 user is empty")
            return
        };
        process.env.P4USER = this.p4user

        //let test = process.env.P4PORT

        this.get_clients()

        const workspacefolders =vscode.workspace.workspaceFolders
        if (!workspacefolders || workspacefolders.length == 0) {
            xp4LogError("Workspace folders get failed")
            return;
        }
            
        let workspacepath = workspacefolders[0].uri.path
        workspacepath.replaceAll('\\', '/')
        if (workspacepath[0] == '/') workspacepath = workspacepath.substring(1)
        workspacepath = disk_to_upper(workspacepath)
        for(let [key, value] of this.all_clients) {
            if (workspacepath.includes(value)) {
                this.p4client = key
                this.localpath = value
                process.env.P4CLIENT = key
                break
            }
        }

        if (this.p4client == "") {
            // console.log("%s can't find match p4client", workspacepath)
            xp4LogError(workspacepath + " can't find match p4client")
            return
        }

        this.p4stream = this.get_stream()
        if (this.p4stream == "") {
            // console.log("p4client=%s can't find stream", this.p4client)
            xp4LogError("Client=" + this.p4client + " can't find stream")
            return
        }

        this.is_active = true

        // console.log("p4 is active")
        xp4LogInfo("p4 is active")

        // 从filectler中取出之前未处理的文件变更

    }

    init_p4_env2(): void {
        process.env.P4CHARSET = 'utf8'
        const p4_configuration = vscode.workspace.getConfiguration('XP4Helper')
    }

    get_user():string {
        let user = ""
        const output = exec_cmd('p4 user -o')[0].toString().split('\n')
        const lines = String(output).split('\n')
        for (let line in lines) {
            if (line.includes("User:")) {
                let pos
                for(let i = 5; i < line.length; i++) {
                    if((line[i] >= 'a' && line[i] <= 'z') || (line[i] >= 'A' && line[i] <= 'Z')) {
                        pos = i
                        break;
                    }
                }
                user = line.slice(pos)
                break
            }
        }

        return user
    }

    get_clients():void {
        const res = exec_cmd('p4 clients -u ' + this.p4user)
        if (res[1] != "") {
            xp4LogError("Get clients failed res=%s", res)
            return
        };
        // const output = execSync('p4 clients -u ' + this.p4user).toString()
        var clients_line = res[0].split("\n")
        for (var each_client_line of clients_line) {
            var client_info = each_client_line.split(" ")
            if (client_info.length < 5) continue
            this.all_clients.set(client_info[1], client_info[4].replaceAll('\\', '/'));
        }
    }

    get_stream():string {
        let stream = ""
        const res = exec_cmd('p4 stream -o')
        if (res[1] != "") return "";
        let lines = res[0].split('\n')
        for (let line of lines) {
            if(line.length == 0 || line[0] == '#') continue;
            if(line.includes('Stream')) {
                stream = line.trim()
                let pos = line.indexOf('//')
                stream = line.substring(pos)
                break
            }
        }
        return stream
    }

    use_cache(res:boolean, out:string):void {
        if(!res) return
        this.is_active = true
    }

    async isinstream_dir(path:string): Promise<boolean> {
        if (path.includes(this.p4stream)) return true
        if (!path.includes(this.localpath)) return false;
        path = path.replace(this.localpath, this.p4stream)
        const res = await exec_cmd_async('p4 dirs ' + path)
        if (res[1] != "") return false
        if (res[0].includes('no such file')) return false
        return true
    }

    async isinstream_file(path:string): Promise<boolean> {
        if (!path.includes(this.localpath)) return false;
        path = path.replace(this.localpath, this.p4stream)
        const res = await exec_cmd_async('p4 filelog -m 1 ' + path)
        if (res[1] != "") return false
        if (res[0].includes('no such file')) return false
        return true
    }
    
    async only_open(path:string): Promise<echeck_res_type> {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!await this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream
        if(!await this.isinstream_file(path)) return echeck_res_type.not_in_stream

        let res = await exec_cmd_async('p4 open ' + path)
        if (!res[0].includes('opened for edit')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    async on_modify(path:string): Promise<echeck_res_type> {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if (!await this.isinstream_dir(get_pre_dir(path))) {
            xp4LogDebug("Path=%s file not in dist", path)
            return echeck_res_type.not_in_stream
        }
        if (!await this.isinstream_file(path)) {
            xp4LogDebug("Path=%s file not in stream", path)
            return echeck_res_type.not_in_stream
        }

        let res = await exec_cmd_async('p4 open ' + path)
        if (!res[0].includes('opened for edit')) {
            xp4LogDebug("Path=%s edit failed res=%s", path, res[0])
            return echeck_res_type.check_conflict
        }
        
        res = await exec_cmd_async('p4 revert -a ' + path)
        if (res[0].includes('reverted')) {
            xp4LogDebug("Path=%s nothing change", path)
            return echeck_res_type.nothing_change
        } 

        xp4LogDebug("Path=%s check success", path)

        return echeck_res_type.success
    }

    async on_add(path:string): Promise<echeck_res_type> {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!await this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream

        let res = await exec_cmd_async('p4 add ' + path)
        if (!res[0].includes('opened for add')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    async on_del(path:string): Promise<echeck_res_type> {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!await this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream

        let res = await exec_cmd_async('p4 delete ' + path)
        if (!res[0].includes('opened for delete')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    async on_rename(old_path:string, new_path:string): Promise<echeck_res_type> {
        if(!this.is_active) return echeck_res_type.not_active

        old_path = disk_to_upper(old_path).replaceAll('\\', '/')
        new_path = disk_to_upper(new_path).replaceAll('\\', '/')
        if(!await this.isinstream_dir(get_pre_dir(old_path)) || !await this.isinstream_dir(get_pre_dir(new_path))) return echeck_res_type.not_in_stream
        const old_stream_path = old_path.replace(this.localpath, this.p4stream)
        const new_stream_path = new_path.replace(this.localpath, this.p4stream)

        let res = await exec_cmd_async('p4 move ' + old_stream_path + ' ' + new_stream_path)
        if (!res[0].includes('moved from')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    // 将库上latest的文件下载到temp目录
    async get_head(path:string): Promise<string> {
        if(!this.is_active) return ""
        
        // todo 每次diff删除之前的temp文件
        let tempfilepath = this.tempdirpath + '\\' + "#head#" +  get_filename(path)
        const res = await exec_cmd_async('p4 print -o ' + tempfilepath + ' ' + path + '#head')
        return tempfilepath
    }

    // Get changelist description by changelist number (async)
    async get_changelist_desc(changelist: string): Promise<string> {
        if (changelist === 'default') return ''
        const res = await exec_cmd_async('p4 change -o ' + changelist)
        if (res[1] !== '') return ''
        const lines = res[0].split('\n')
        let foundDesc = false
        let desc = ''
        for (const line of lines) {
            if (line.startsWith('Description:')) {
                foundDesc = true
                continue
            }
            if (foundDesc) {
                // Description ends when we hit another field (line starting without whitespace)
                if (line.length > 0 && line[0] !== '\t' && line[0] !== ' ') {
                    break
                }
                const trimmed = line.trim()
                if (trimmed.length > 0) {
                    desc += (desc.length > 0 ? ' ' : '') + trimmed
                }
            }
        }
        return desc
    }

    async get_opened(): Promise<{files: Map<string, filectl.OpenedFileInfo>, descriptions: Map<string, string>}> {
        let files = new Map<string, filectl.OpenedFileInfo>()
        let descriptions = new Map<string, string>()

        if(!this.is_active) return {files, descriptions}

        const res = await exec_cmd_async('p4 opened')
        if(res[1] != "") return {files, descriptions}

        const changelistSet = new Set<string>()
        const lines = res[0].split('\n')
        for(let line of lines) {
            if (line.length < 2) continue
            let pos = line.lastIndexOf('#')
            let streampath = line.substring(0, pos)
            let change_info = line.substring(pos)
            let update_type:filectl.eupdate_type
            if (change_info.includes('edit')) {
                update_type = filectl.eupdate_type.modify
            } else if(change_info.includes('add')) {
                update_type = filectl.eupdate_type.add
            } else if(change_info.includes('delete')) {
                update_type = filectl.eupdate_type.delete
            }

            // Parse changelist number from output
            // Format: #rev - action default change (type) OR #rev - action change 12345 (type)
            let changelist = 'default'
            const changeMatch = change_info.match(/change\s+(\d+)/)
            if (changeMatch) {
                changelist = changeMatch[1]
            }
            changelistSet.add(changelist)

            files.set(
                (streampath.replace(this.p4stream, this.localpath)).replaceAll('/', '\\'),
                { update_type: update_type!, changelist: changelist }
            )
        }

        // Fetch descriptions for all numbered changelists in parallel
        const descPromises: Promise<void>[] = []
        for (const cl of changelistSet) {
            if (cl !== 'default') {
                descPromises.push(
                    this.get_changelist_desc(cl).then(desc => {
                        descriptions.set(cl, desc)
                    })
                )
            }
        }
        await Promise.all(descPromises)

        return {files, descriptions}
    }

    async try_revert(path:string): Promise<boolean> {
        const res = await exec_cmd_async('p4 revert -a ' + path)
        if(res[1] != "") return false
        return res[0].includes('reverted')
    }

    async force_revert(path:string): Promise<void> {
        await exec_cmd_async('p4 revert ' + path)
    }

    // Move file to another changelist: p4 reopen -c <cl> <file>
    async reopen_changelist(filepath: string, changelist: string): Promise<boolean> {
        if (!this.is_active) return false
        const cl = changelist === 'default' ? 'default' : changelist
        const res = await exec_cmd_async(`p4 reopen -c ${cl} ${filepath}`)
        if (res[1] !== '') {
            xp4LogError("Reopen failed: %s", res[1])
            return false
        }
        return true
    }

    // Create a new pending changelist, returns the changelist number
    async create_changelist(description: string): Promise<string> {
        if (!this.is_active) return ''
        // Build change spec via stdin
        const spec = `Change: new\nClient: ${this.p4client}\nUser: ${this.p4user}\nStatus: new\nDescription:\n\t${description.replace(/\n/g, '\n\t')}\n`
        const res = await exec_cmd_async(`echo ${spec} | p4 change -i`)
        if (res[1] !== '') {
            xp4LogError("Create changelist failed: %s", res[1])
            return ''
        }
        // Output: "Change 12345 created."
        const match = res[0].match(/Change\s+(\d+)\s+created/)
        if (match) return match[1]
        return ''
    }

    // Submit a changelist: p4 submit -c <cl>
    async submit_changelist(changelist: string): Promise<{success: boolean, message: string}> {
        if (!this.is_active) return {success: false, message: 'P4 not active'}
        if (changelist === 'default') {
            // Submit default changelist
            const res = await exec_cmd_async('p4 submit')
            if (res[1] !== '' && !res[0].includes('submitted')) {
                return {success: false, message: res[1] || res[0]}
            }
            return {success: true, message: res[0]}
        }
        const res = await exec_cmd_async(`p4 submit -c ${changelist}`)
        if (res[1] !== '' && !res[0].includes('submitted')) {
            return {success: false, message: res[1] || res[0]}
        }
        return {success: true, message: res[0]}
    }

    // Get file history: p4 filelog -l -m <max> <file>
    async get_filelog(filepath: string, maxRevisions: number = 20): Promise<{revision: string, changelist: string, action: string, date: string, user: string, description: string}[]> {
        if (!this.is_active) return []
        const normalizedPath = disk_to_upper(filepath).replaceAll('\\', '/')
        const streampath = normalizedPath.replace(this.localpath, this.p4stream)
        const res = await exec_cmd_async(`p4 filelog -l -m ${maxRevisions} "${streampath}"`)
        if (res[1] !== '' || res[0] === '') return []

        const results: {revision: string, changelist: string, action: string, date: string, user: string, description: string}[] = []
        const lines = res[0].split('\n')
        let i = 0
        while (i < lines.length) {
            const line = lines[i]
            // Match: ... #rev change cl action on date by user@client (type)
            const revMatch = line.match(/\.\.\.\s+#(\d+)\s+change\s+(\d+)\s+(\S+)\s+on\s+(\S+)\s+by\s+(\S+)@/)
            if (revMatch) {
                const revision = revMatch[1]
                const changelist = revMatch[2]
                const action = revMatch[3]
                const date = revMatch[4]
                const user = revMatch[5]
                // Collect description lines (indented lines following the revision line)
                let desc = ''
                i++
                while (i < lines.length && (lines[i].startsWith('\t') || lines[i].startsWith(' '))) {
                    const trimmed = lines[i].trim()
                    if (trimmed.length > 0) {
                        desc += (desc.length > 0 ? ' ' : '') + trimmed
                    }
                    i++
                }
                results.push({revision, changelist, action, date, user, description: desc})
            } else {
                i++
            }
        }
        return results
    }

    // Get all pending changelists for current user/client
    async get_pending_changelists(): Promise<{changelist: string, description: string}[]> {
        if (!this.is_active) return []
        const res = await exec_cmd_async(`p4 changes -s pending -u ${this.p4user} -c ${this.p4client}`)
        if (res[1] !== '' || res[0] === '') return []
        const results: {changelist: string, description: string}[] = []
        // Always include default
        results.push({changelist: 'default', description: 'default'})
        const lines = res[0].split('\n')
        for (const line of lines) {
            // Format: Change 12345 on 2024/01/01 by user@client *pending* 'description'
            const match = line.match(/Change\s+(\d+)\s+on\s+\S+\s+by\s+\S+\s+\*pending\*\s*'?(.*?)'?\s*$/)
            if (match) {
                results.push({changelist: match[1], description: match[2] || `Change ${match[1]}`})
            }
        }
        return results
    }

    // Checkout (open for edit) a file
    async checkout_file(filepath: string): Promise<{success: boolean, message: string}> {
        if (!this.is_active) return {success: false, message: 'P4 not active'}
        const path = disk_to_upper(filepath).replaceAll('\\', '/')
        const res = await exec_cmd_async('p4 edit ' + path)
        if (res[0].includes('opened for edit')) {
            return {success: true, message: res[0]}
        }
        return {success: false, message: res[1] || res[0]}
    }

    // Diff with head: get head file path for diff
    async diff_with_head(filepath: string): Promise<string> {
        return await this.get_head(filepath)
    }

    // Get a specific revision of a file to temp dir: p4 print -o <temp> <file>#<rev>
    async get_revision(filepath: string, revision: string): Promise<string> {
        if (!this.is_active) return ''
        const normalizedPath = disk_to_upper(filepath).replaceAll('\\', '/')
        const streampath = normalizedPath.replace(this.localpath, this.p4stream)
        const tempfilepath = this.tempdirpath + '\\' + `#${revision}#` + get_filename(filepath)
        const res = await exec_cmd_async(`p4 print -o ${tempfilepath} "${streampath}#${revision}"`)
        if (res[1] !== '' && !res[0].includes(streampath)) return ''
        return tempfilepath
    }

    async get_commit_author(path: string, linenumber: number): Promise<{author:string, date: string}> {
        if (!this.is_active) return {author: '', date: ''}
        
        let start = Date.now()
        const normalizedPath = path.replaceAll('\\', '/')

        // Check annotate cache
        let cacheEntry = this.annotateCache.get(normalizedPath)
        if (cacheEntry && (Date.now() - cacheEntry.timestamp) < p4helper.ANNOTATE_CACHE_TTL) {
            // Cache hit: use cached data
            if (linenumber >= cacheEntry.lineChangelists.length) return {author: '', date: ''}
            const changelist = cacheEntry.lineChangelists[linenumber]
            const info = cacheEntry.changelistInfo.get(changelist)
            if (info) {
                xp4LogDebug("Annotate cache hit, cost=%dms", Date.now() - start)
                return info
            }
            // Changelist not yet resolved, fetch it
            const descRes = await exec_cmd_async(`p4 describe -s ${changelist}`)
            if (descRes[1] === '' && descRes[0] !== '') {
                const firstLine = descRes[0].split('\n')[0]
                const byMatch = firstLine.match(/by\s+(\S+)@\S+\s+on\s+(\S+)/)
                if (byMatch) {
                    const result = {author: byMatch[1], date: byMatch[2]}
                    cacheEntry.changelistInfo.set(changelist, result)
                    return result
                }
            }
            return {author: '', date: ''}
        }

        // Cache miss: run p4 annotate
        const streampath = normalizedPath.replace(this.localpath, this.p4stream)
        const annotateRes = await exec_cmd_async(`p4 annotate -c "${streampath}"`)
        xp4LogDebug("Annotate cost=%dms", Date.now() - start)
        if (annotateRes[1] !== '' || annotateRes[0] === '') {
            return {author: '', date: ''}
        }

        const lines = annotateRes[0].split('\n')
        
        // Build cache: parse all line changelists
        const lineChangelists: string[] = []
        const uniqueChangelists = new Set<string>()
        for (const line of lines) {
            const colonPos = line.indexOf(':')
            if (colonPos === -1) {
                lineChangelists.push('')
                continue
            }
            const cl = line.substring(0, colonPos).trim()
            lineChangelists.push(cl)
            uniqueChangelists.add(cl)
        }

        // Fetch all unique changelist descriptions in parallel
        const changelistInfo = new Map<string, {author: string, date: string}>()
        const descPromises: Promise<void>[] = []
        for (const cl of uniqueChangelists) {
            if (cl === '') continue
            descPromises.push(
                exec_cmd_async(`p4 describe -s ${cl}`).then(descRes => {
                    if (descRes[1] === '' && descRes[0] !== '') {
                        const firstLine = descRes[0].split('\n')[0]
                        const byMatch = firstLine.match(/by\s+(\S+)@\S+\s+on\s+(\S+)/)
                        if (byMatch) {
                            changelistInfo.set(cl, {author: byMatch[1], date: byMatch[2]})
                        }
                    }
                })
            )
        }
        await Promise.all(descPromises)

        // Store in cache
        this.annotateCache.set(normalizedPath, {
            changelistInfo,
            lineChangelists,
            timestamp: Date.now()
        })

        xp4LogDebug("Annotate full fetch + cache build cost=%dms", Date.now() - start)

        // Return result for requested line
        if (linenumber >= lineChangelists.length) return {author: '', date: ''}
        const changelist = lineChangelists[linenumber]
        return changelistInfo.get(changelist) || {author: '', date: ''}
    }
}