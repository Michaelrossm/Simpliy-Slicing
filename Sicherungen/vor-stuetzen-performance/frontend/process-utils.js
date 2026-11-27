export const isVisibleProcess = process => !['support-body','support-interface','prusa-support'].includes(process.role);
export const visibleProcesses = processes => processes.filter(isVisibleProcess);
