// Luna — terminal banner & identity art
import { gradient, ansi } from '../util/ansi.js';
import { IDENTITY, DIRS, LUNA_ROOT } from '../constants.js';

export function banner() {
  const moon = [
    '        ,%%%%,',
    '       ,%%%` %==--',
    '      ,%%`(2)%%%      `',
    '      %%@,_*         `  ',
    '        ,%%%%@-_       `',
    '      _____%%%@/__    __',
    '     /     `n/  `\\  /`\\',
    '    /___ /^^^/ /^^\\/   \\',
    '        \\n/  /`  `\\/   `\\',
    '        /`  /  @   |    |',
    '       (  ^^ \\   /^ /  /',
    '        \\  @  `-,  ` ,` /',
    '        /^^^`   `\\  \\  `\\',
    '               `` \\ \\\\ /`',
    '    ~~~Luna~~~      \\/~~',
  ];
  const lines = [];
  for (const line of moon) lines.push(ansi.brightMagenta(ansi.dim(line)));
  lines.push('');
  lines.push('  ' + gradient(`✦  ${IDENTITY.name.toUpperCase()}  ✦`) + ansi.dim(`  v${IDENTITY.version}`));
  lines.push('  ' + ansi.dim(IDENTITY.tagline));
  return lines.join('\n');
}

export function bootLine() {
  return ansi.dim(`  brain: ${DIRS.home}  ·  self: ${LUNA_ROOT}`);
}

export function helpSlash() {
  return `
${gradient('Luna commands')}
${ansi.bold('/help')}          this help
${ansi.bold('/memory')}       memory bank stats & search — /memory search <q>
${ansi.bold('/save')} <text>  save a memory — /save <bank> | <text>
${ansi.bold('/recall')} <q>   recall memories
${ansi.bold('/forget')} <q>   delete matching memories
${ansi.bold('/skills')}      list skills — /skills <name> shows one — /skills run <name>
${ansi.bold('/self')}        self info, check, snapshot, rollback — /self check
${ansi.bold('/providers')}   available AI endpoints — /provider <id> switch — /model <id>
${ansi.bold('/health')}      probe all endpoints (parallel)
${ansi.bold('/doctor')}      full self-diagnostic
${ansi.bold('/skill')}       alias of /skills run
${ansi.bold('/git')}         git status of current dir
${ansi.bold('/log')}         recent internal log
${ansi.bold('/stats')}       session stats
${ansi.bold('/config')}      show effective config
${ansi.bold('/clear')}       clear screen & session context
${ansi.bold('/exit')}        leave (memories persist)
${ansi.dim('multiline: end a line with " \\" · ctrl+c twice to quit hard')}
`;
}

export function goodbye() {
  return gradient('☽ luna sleeps — memories saved') + '\n';
}
