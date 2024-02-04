import { eupdate_type, filectl, filenode } from "./filectl/filectl";
import { p4helper, echeck_res_type } from "./p4v/p4helper";
import * as fs from 'fs'

function on_old_modify(old_filenode:filenode, p4helperins:p4helper, filectler:filectl):boolean {
    const filepath = old_filenode.filepath
    switch(old_filenode.update_type) {
        case eupdate_type.modify: {
            if(p4helperins.try_revert(filepath)) {
                filectler.del_filenode(filepath, old_filenode.update_type)
                return true
            }
        }break;
        case eupdate_type.add: {
            // nothing todo
        }break;
        case eupdate_type.delete: {
            const temp_path = filepath + Math.random()
            fs.copyFileSync(filepath, temp_path)
            p4helperins.force_revert(filepath)
            fs.rmSync(filepath)
            fs.renameSync(temp_path, filepath)
            if(p4helperins.on_modify(filepath) == echeck_res_type.success) {
                filectler.mv_filenode(filepath, old_filenode.update_type, eupdate_type.modify)
            } else {
                filectler.del_filenode(filepath, old_filenode.update_type)
            }
            return true
        }break;
    }

    return false
}

function on_old_add(old_filenode:filenode, p4helperins:p4helper, filectler:filectl):boolean {
    const filepath = old_filenode.filepath
    switch(old_filenode.update_type) {
        case eupdate_type.modify: {
            // nothing todo
        }break;
        case eupdate_type.add: {
            // nothing todo
        }break;
        case eupdate_type.delete: {
            p4helperins.force_revert(filepath)
            filectler.del_filenode(filepath, old_filenode.update_type)
            return true
        }break;
    }

    return false
}

function on_old_del(old_filenode:filenode, p4helperins:p4helper, filectler:filectl):boolean {
    const filepath = old_filenode.filepath
    switch(old_filenode.update_type) {
        case eupdate_type.modify: {
            filectler.mv_filenode(filepath, old_filenode.update_type, eupdate_type.delete)
            return p4helperins.on_del(filepath) == echeck_res_type.success
        }break;
        case eupdate_type.add: {
            filectler.del_filenode(filepath, old_filenode.update_type)
            p4helperins.force_revert(filepath)
            return true
        }break;
        case eupdate_type.delete: {
            // nothing todo
        }break;
    }

    return false
}

function on_old_rename(old_filenode:filenode, p4helperins:p4helper, filectler:filectl, new_path:string):boolean {
    const filepath = old_filenode.filepath
    switch(old_filenode.update_type) {
        case eupdate_type.modify: {
            filectler.mv_filenode(filepath, old_filenode.update_type, eupdate_type.rename)
            return p4helperins.on_rename(filepath, new_path) == echeck_res_type.success
        }break;
        case eupdate_type.add: {
            filectler.mv_filenode(filepath, old_filenode.update_type, eupdate_type.rename)
            return p4helperins.on_rename(filepath, new_path) == echeck_res_type.success
        }break;
        case eupdate_type.delete: {
            // nothing todo
        }break;
    }

    return false
}

function p4action(check_res:echeck_res_type, filectler:filectl, path:string, update_type:eupdate_type):boolean|undefined {
    switch(check_res) {
        case echeck_res_type.not_active: break;
        case echeck_res_type.not_in_stream: break;
        case echeck_res_type.check_conflict: break;
        case echeck_res_type.nothing_change: break;
        case echeck_res_type.success: {
            filectler.add_filenode(path, update_type)
            return true
        }break; 
    }
}

export function on_modify(old_filenode:filenode|undefined, p4helperins:p4helper, filectler:filectl, path:string):boolean {
    if(old_filenode !== undefined) {
        return on_old_modify(old_filenode, p4helperins, filectler)
    }

    return p4action(p4helperins.on_modify(path), filectler, path, eupdate_type.modify) !== undefined
}

export function on_add(old_filenode:filenode|undefined, p4helperins:p4helper, filectler:filectl, path:string):boolean {
    if(old_filenode !== undefined) {
        return on_old_add(old_filenode, p4helperins, filectler)
    }

    return p4action(p4helperins.on_add(path), filectler, path, eupdate_type.add) !== undefined
}

export function on_del(old_filenode:filenode|undefined, p4helperins:p4helper, filectler:filectl, path:string):boolean {
    if(old_filenode !== undefined) {
        return on_old_del(old_filenode, p4helperins, filectler)
    }

    return p4action(p4helperins.on_del(path), filectler, path, eupdate_type.delete) !== undefined
}

export function on_rename(old_filenode:filenode|undefined, p4helperins:p4helper, filectler:filectl, old_path:string, new_path:string):boolean {
    if(old_filenode !== undefined) {
        return on_old_rename(old_filenode, p4helperins, filectler, new_path)
    }

    if(p4helperins.on_del(old_path)!=echeck_res_type.success) return false

    if(p4helperins.on_add(new_path)!=echeck_res_type.success) return false

    filectler.add_filenode(old_path, eupdate_type.delete)
    filectler.add_filenode(new_path, eupdate_type.add)

    return true
}

export function rm_head_slash(path:string):string {
    if(path.length == 0) return path
    if(path[0] == '/') return path.substring(1)
    return path
}