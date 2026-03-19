interface Category {
  name: string;
  patterns: RegExp[];
}

const CATEGORIES: Category[] = [
  {
    name: 'merge-conflict',
    patterns: [/merge conflict/i, /conflict marker/i, /UU status/i, /<<<<<</, /=======/],
  },
  {
    name: 'security',
    patterns: [
      /IDOR/i,
      /injection/i,
      /credential/i,
      /\bsecret\b/i,
      /hardcoded.*(?:key|password|token|secret|api)/i,
      /XSS/i,
      /CSRF/i,
      /org.?scope/i,
      /missing.*scope/i,
      /cross.?org/i,
      /another org/i,
      /attacker/i,
    ],
  },
  {
    name: 'regression',
    patterns: [
      /regression/i,
      /breaking.*change/i,
      /break.*existing/i,
      /was.*(?:removed|dropped|lost)/i,
      /no longer/i,
      /the old/i,
      /the original/i,
      /was the correct/i,
    ],
  },
  {
    name: 'bug',
    patterns: [
      /TypeError/i,
      /throw[sn]?\b/i,
      /off.?by.?one/i,
      /will fail/i,
      /\bundefined\b/i,
      /\bNaN\b/i,
      /crash/i,
      /mismatch/i,
      /incorrect(?:ly)?/i,
      /fails?\b.*(?:with|when|for|if|on|silently)/i,
      /not.*(?:awaited|handled|guarded|checked|applied|propagated|reset)/i,
      /missing.*(?:error|check|guard|validation|constraint|state|reset)/i,
      /always.*(?:return|set|use|pass|send)/i,
      /never.*(?:match|fire|trigger|reset|clear|applied)/i,
      /silently\b/i,
      /non.null assertion/i,
      /unconditional/i,
      /uses.*wrong/i,
      /not a valid/i,
      /has no effect/i,
      /passed.*(?:directly|unchecked|without)/i,
    ],
  },
  {
    name: 'error-handling',
    patterns: [
      /silently swallow/i,
      /uncaught/i,
      /no error handling/i,
      /unhandled/i,
      /try.?catch.*(?:silent|swallow|ignore)/i,
      /not.*wrapped.*(?:try|catch|finally)/i,
      /span\.end\(\).*dropped/i,
      /promise.*(?:not|un).*(?:handled|caught|awaited)/i,
    ],
  },
  {
    name: 'race-condition',
    patterns: [
      /race condition/i,
      /concurrent/i,
      /no concurrency guard/i,
      /two.*request/i,
      /parallel.*(?:write|read|access)/i,
    ],
  },
  {
    name: 'performance',
    patterns: [
      /sequential await/i,
      /[oO]\([nN]\)/i,
      /\bsleep\b/i,
      /latency/i,
      /cold.?start/i,
      /[nN]\+1/i,
      /redundant.*(?:query|fetch|DB|database|call|request)/i,
      /bundle size/i,
      /busy.?wait/i,
      /re.?quer(?:y|ies)/i,
      /unnecessary.*(?:extra|copy|sort|work|scan|iteration)/i,
      /(?:unbounded|no.*(?:upper|size).*bound).*(?:loop|memory|accumul|grow)/i,
      /called.*(?:twice|again|redundant)/i,
      /extra.*(?:query|fetch|round.?trip|DB|call|scan)/i,
      /all.*(?:into memory|loaded)/i,
    ],
  },
  {
    name: 'dead-code',
    patterns: [
      /dead code/i,
      /never used/i,
      /\bunused\b/i,
      /unreachable/i,
      /not imported/i,
      /dead prop/i,
      /dead guard/i,
      /copy.?paste[d]?/i,
      /duplicat(?:e[ds]?|ion)/i,
      /verbatim/i,
      /no.*(?:behavioral|functional).*(?:purpose|benefit|effect)/i,
      /test.*(?:artifact|scaffolding|comment).*committed/i,
    ],
  },
  {
    name: 'needless-complexity',
    patterns: [
      /needless(?:ly)?.*complex/i,
      /reimplements?\b/i,
      /hand.?roll/i,
      /Math\.min/i,
      /Array\.(?:includes|prototype)/i,
      /unnecessary.*(?:indirection|wrapper|intermediate|conversion)/i,
      /Promise\.allSettled.*single/i,
    ],
  },
  {
    name: 'spec-issue',
    patterns: [
      /plan\b.*(?:describ|instruct|state|list|propos)/i,
      /task \d+/i,
      /step \d+.*instruct/i,
      /already.*(?:exists?|implement)/i,
      /misleading.*(?:guidance|comment|message|docstring|description)/i,
      /contradicts?/i,
      /not accounted for/i,
      /commit message.*(?:still|list|mention)/i,
    ],
  },
];

export function categorizeFinding(message: string): string[] {
  if (!message) return ['uncategorized'];

  const matches: string[] = [];
  for (const category of CATEGORIES) {
    if (category.patterns.some((pattern) => pattern.test(message))) {
      matches.push(category.name);
    }
  }
  return matches.length > 0 ? matches : ['uncategorized'];
}
