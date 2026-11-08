export function latexToOmml(latex: string): string {
  return `<m:oMath><m:r><m:t>${latex}</m:t></m:r></m:oMath>`
}
