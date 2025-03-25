import * as vscode from 'vscode';
import { sprintf } from 'sprintf-js'

enum LOG_LEVEL_ID {
    "DEBUG" = 1,
    "INFO",
    "WARN",
    "ERROR"
}

let log_level = LOG_LEVEL_ID.INFO

export const output_channel = vscode.window.createOutputChannel('XP4Helper')

export function xp4Log(str:string) {
    output_channel.append(str + "\n")
    // output_channel.show(false)
}

export function xp4LogDebug(fmtstr: string, ...args: any[]) {
    if (log_level > LOG_LEVEL_ID.DEBUG) return
    const str = sprintf("DEBUG " + fmtstr, ...args)
    xp4Log(str)
}

export function xp4LogInfo(fmtstr: string, ...args: any[]) {
    if (log_level > LOG_LEVEL_ID.INFO) return
    const str = sprintf("INFO " + fmtstr, ...args)
    xp4Log(str)
}

export function xp4LogWarn(fmtstr: string, ...args: any[]) {
    if (log_level > LOG_LEVEL_ID.WARN) return
    const str = sprintf("WARN " + fmtstr, ...args)
    xp4Log(str)
}

export function xp4LogError(fmtstr: string, ...args: any[]) {
    if (log_level > LOG_LEVEL_ID.ERROR) return
    const str = sprintf("ERROR " + fmtstr, ...args)
    xp4Log(str)
}

export function setLogLevel(str: string) {
    switch (str) {
        case "DEBUG": log_level = LOG_LEVEL_ID.DEBUG; break;
        case "INFO": log_level = LOG_LEVEL_ID.INFO; break;
        case "WARN": log_level = LOG_LEVEL_ID.WARN; break;
        case "ERROR": log_level = LOG_LEVEL_ID.ERROR; break;
        default: log_level = LOG_LEVEL_ID.INFO;
    }
}