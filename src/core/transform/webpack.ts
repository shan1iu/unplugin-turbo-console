import type { WithScope } from 'ast-kit'
import { babelParse, getLang, walkAST } from 'ast-kit'
import type { Node } from '@babel/types'
import MagicString from 'magic-string'
import type { Context } from '../../types'
import { isPluginDisable } from '../utils'
import { genConsoleString, isConsoleExpression } from './common'

const vuePatterns = [/\.vue$/, /\.vue\?vue/, /\.vue\?v=/]

export async function webpackTransform(context: Context) {
  const { id, code, options } = context
  let scriptString = code
  let scriptLang = getLang(context.id)
  let vueSfcLocStart = {
    line: 0,
    column: 0,
    offset: 0,
  }
  const magicString = new MagicString(code)
  if (vuePatterns.some(pattern => pattern.test(id))) {
    // dynamic import
    const { parse } = await import('vue/compiler-sfc')

    const { descriptor, errors } = parse(code, {
      filename: id,
    })

    if (errors.length === 0) {
      if (descriptor.script) {
        scriptString = descriptor.script.content
        scriptLang = descriptor.script.lang || ''
        vueSfcLocStart = descriptor.script.loc.start
      }

      else if (descriptor.scriptSetup) {
        scriptString = descriptor.scriptSetup.content
        scriptLang = descriptor.scriptSetup.lang || ''
        vueSfcLocStart = descriptor.scriptSetup.loc.start
      }

      vueSfcLocStart.line--
    }
  }
  const program = babelParse(scriptString, scriptLang, {
    sourceFilename: id,
  })

  walkAST<WithScope<Node>>(program, {
    enter(node) {
      if (isConsoleExpression(node)) {
        const expressionStart = node.start!
        const expressionEnd = node.end!

        const originalExpression = magicString.slice(expressionStart, expressionEnd)

        if (originalExpression.includes('%c'))
          return false

        const { line, column } = node.loc!.start
        // @ts-expect-error any
        const args = node.arguments

        const argsStart = args[0].start! + vueSfcLocStart.offset
        const argsEnd = args[args.length - 1].end! + vueSfcLocStart.offset
        const argType = args[0].type

        const argsName = magicString.slice(argsStart, argsEnd)
          .toString()
          .replace(/`/g, '')
          .replace(/\n/g, '')
          .replace(/"/g, '')

        const originalLine = line + vueSfcLocStart.line
        const originalColumn = column

        if (code) {
          const lineContentArr = code.split('\n')
          if (isPluginDisable({ lineContentArr, originalLine, id }))
            return
        }

        const { consoleString, _suffix } = genConsoleString({
          options,
          originalLine,
          originalColumn,
          argType,
          argsName,
          id,
        })

        consoleString && magicString.appendLeft(argsStart, consoleString)
        _suffix && magicString.appendRight(argsEnd, `,"${_suffix}"`)
      }
    },
  })

  return {
    code: magicString.toString(),
    map: magicString.generateMap({ source: id }),
  }
}
