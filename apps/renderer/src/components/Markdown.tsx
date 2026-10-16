import { memo, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { copyText } from '../lib/clipboard';

// 只注册会用到的语言，控制打包体积。
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/** 常见别名 → highlight.js 语言名。 */
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'xml',
  htm: 'xml',
  yml: 'yaml',
  md: 'markdown',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 高亮模型输出的代码块（内容不可信：hljs 会转义，失败时退回 escapeHtml）。 */
function highlight(code: string, lang: string): string {
  const name = LANG_ALIAS[lang] ?? lang;
  if (name && hljs.getLanguage(name)) {
    try {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    } catch {
      // 高亮失败则退回转义原文
    }
  }
  return escapeHtml(code);
}

/** 在系统浏览器打开链接（Electron 主进程已禁止渲染进程内导航）。 */
function openExternal(url: string): void {
  const api = window.fireeyeaud;
  if (api?.openExternal) {
    void api.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function CodeBlock({ lang, code, plain }: { lang: string; code: string; plain: boolean }) {
  const { t } = useTranslation('agent');
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => (plain ? '' : highlight(code, lang)), [code, lang, plain]);

  const onCopy = () => {
    void copyText(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="md-code">
      <div className="md-code__head">
        <span className="md-code__lang">{lang || 'text'}</span>
        <button
          type="button"
          className="md-code__copy"
          title={copied ? t('copied') : t('copyCode')}
          aria-label={t('copyCode')}
          onClick={onCopy}
        >
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.9} />}
        </button>
      </div>
      <pre className="md-code__pre">
        {plain ? (
          <code className="md-code__code">{code}</code>
        ) : (
          <code className="md-code__code hljs" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </pre>
    </div>
  );
}

interface MarkdownProps {
  content: string;
  /** 流式未完时不调用高亮，避免逐 token 重复高亮的卡顿。 */
  plain?: boolean;
}

function MarkdownInner({ content, plain = false }: MarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        return (
          <a
            href={href}
            className="md-link"
            onClick={(event) => {
              event.preventDefault();
              if (href) openExternal(href);
            }}
          >
            {children}
          </a>
        );
      },
      pre({ children }) {
        const child = Array.isArray(children) ? children[0] : children;
        const codeProps = (
          child as { props?: { className?: string; children?: ReactNode } } | null
        )?.props;
        const lang = /language-([\w+#-]+)/.exec(codeProps?.className ?? '')?.[1] ?? '';
        const code = String(codeProps?.children ?? '').replace(/\n$/, '');
        return <CodeBlock lang={lang} code={code} plain={plain} />;
      },
      code({ className, children }) {
        const isBlock = /language-/.test(className ?? '');
        return <code className={isBlock ? className : 'md-inline-code'}>{children}</code>;
      },
    }),
    [plain],
  );

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
