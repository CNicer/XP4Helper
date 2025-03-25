import * as vscode from 'vscode'
import {exec, spawnSync} from 'child_process'
import * as filectl from '../filectl/filectl'
import { open, readFileSync, writeFileSync } from 'fs'
import * as iconv from 'iconv-lite'
import { output_channel, xp4LogDebug, xp4LogError, xp4LogInfo, xp4LogWarn } from '../output/output'

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

function exec_cmd(cmd:string):string[] {
    const result = spawnSync(cmd, [], {shell:true, encoding:'utf-8'})
    return [result.stdout.replaceAll('\r\n', '\n'), result.stderr.replaceAll('\r\n', '\n')]
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

    constructor(filectler: filectl.filectl) {
        this.filectler = filectler
        this.init_p4_env()
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

    isinstream_dir(path:string): boolean {
        if (path.includes(this.p4stream)) return true
        if (!path.includes(this.localpath)) return false;
        path = path.replace(this.localpath, this.p4stream)
        const res = exec_cmd('p4 dirs ' + path)
        if (res[1] != "") return false
        if (res[0].includes('no such file')) return false
        return true
    }

    isinstream_file(path:string): boolean {
        if (!path.includes(this.localpath)) return false;
        path = path.replace(this.localpath, this.p4stream)
        const res = exec_cmd('p4 filelog -m 1 ' + path)
        if (res[1] != "") return false
        if (res[0].includes('no such file')) return false
        return true
    }
    
    only_open(path:string):echeck_res_type {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream
        if(!this.isinstream_file(path)) return echeck_res_type.not_in_stream

        let res = exec_cmd('p4 open ' + path)
        if (!res[0].includes('opened for edit')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    on_modify(path:string): echeck_res_type {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if (!this.isinstream_dir(get_pre_dir(path))) {
            // console.log("Path=%s file not in disk", path)
            xp4LogDebug("Path=%s file not in dist", path)
            return echeck_res_type.not_in_stream
        }
        if (!this.isinstream_file(path)) {
            // console.log("Path=%s file not in stream", path)
            xp4LogDebug("Path=%s file not in stream", path)
            return echeck_res_type.not_in_stream
        }

        let res = exec_cmd('p4 open ' + path)
        if (!res[0].includes('opened for edit')) {
            // console.log("Path=%s edit failed", path)
            xp4LogDebug("Path=%s edit failed res=%s", path, res[0])
            return echeck_res_type.check_conflict
        }
        
        res = exec_cmd('p4 revert -a ' + path)
        if (res[0].includes('reverted')) {
            // console.log("Path=%s nothing change", path)
            xp4LogDebug("Path=%s nothing change", path)
            return echeck_res_type.nothing_change
        } 

        // console.log("Path=%s check success", path)
        xp4LogDebug("Path=%s check success", path)

        return echeck_res_type.success
    }

    on_add(path:string): echeck_res_type {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream

        let res = exec_cmd('p4 add ' + path)
        if (!res[0].includes('opened for add')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    on_del(path:string): echeck_res_type {
        if(!this.is_active) return echeck_res_type.not_active

        path = disk_to_upper(path).replaceAll('\\', '/')
        if(!this.isinstream_dir(get_pre_dir(path))) return echeck_res_type.not_in_stream

        let res = exec_cmd('p4 delete ' + path)
        if (!res[0].includes('opened for delete')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    on_rename(old_path:string, new_path:string): echeck_res_type {
        if(!this.is_active) return echeck_res_type.not_active

        old_path = disk_to_upper(old_path).replaceAll('\\', '/')
        new_path = disk_to_upper(new_path).replaceAll('\\', '/')
        if(!this.isinstream_dir(get_pre_dir(old_path)) || !this.isinstream_dir(get_pre_dir(new_path))) return echeck_res_type.not_in_stream
        const old_stream_path = old_path.replace(this.localpath, this.p4stream)
        const new_stream_path = new_path.replace(this.localpath, this.p4stream)

        let res = exec_cmd('p4 move ' + old_stream_path + ' ' + new_stream_path)
        if (!res[0].includes('moved from')) return echeck_res_type.check_conflict

        return echeck_res_type.success
    }

    // 将库上latest的文件下载到temp目录
    get_head(path:string):string {
        if(!this.is_active) return ""
        
        // todo 每次diff删除之前的temp文件
        let tempfilepath = this.tempdirpath + '\\' + "#head#" +  get_filename(path)
        const res = exec_cmd('p4 print -o ' + tempfilepath + ' ' + path + '#head')
        // let data = readFileSync(tempfilepath)
        // let utf8data = iconv.decode(data, 'gbk')
        // writeFileSync(tempfilepath, utf8data, 'utf-8')
        return tempfilepath
    }

    get_opened():Map<string, filectl.eupdate_type> {
        let opened = new Map<string, filectl.eupdate_type>()

        if(!this.is_active) return opened

        const res = exec_cmd('p4 opened')
        if(res[1] != "") return opened

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
            opened.set((streampath.replace(this.p4stream, this.localpath)).replaceAll('/', '\\'), update_type!)
        }

        return opened
    }

    try_revert(path:string):boolean {
        const res = exec_cmd('p4 revert -a ' + path)
        if(res[1] != "") return false
        return res[0].includes('reverted')
    }

    force_revert(path:string) {
        exec_cmd('p4 revert ' + path)
    }
}