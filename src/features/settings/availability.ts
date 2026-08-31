/** 目录打不开时仍可进入常规页换目录；只有真正依赖库数据的表单需要禁用。 */
export function isSettingsPageDisabled(groupId: string, pageId: string, workspaceOpen: boolean): boolean {
  return groupId === 'workspace' && pageId !== 'workspace' && !workspaceOpen
}
