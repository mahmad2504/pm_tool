/** Label for project pickers and lists (sub-projects: Parent → Sub). */
export function projectListLabel(
  name: string,
  isRoot: boolean,
  parentName?: string | null,
): string {
  if (isRoot || !parentName) {
    return name;
  }
  return `${parentName} -> ${name}`;
}
