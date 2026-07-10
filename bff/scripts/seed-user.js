#!/usr/bin/env node
'use strict';
/*
 * 관리자 계정 생성/갱신.
 * 사용법:
 *   npm run seed:user -- --username admin --password 'secret123'
 *   (인자 생략 시 대화형 입력)
 * 비밀번호는 bcrypt 해시로만 저장된다 (bff/data/users.json, .gitignore 대상).
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { createUserStore } = require('../src/users/userStore');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--username') out.username = argv[++i];
    else if (argv[i] === '--password') out.password = argv[++i];
  }
  return out;
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) {
    // 입력 문자를 에코하지 않는다.
    const onData = (char) => {
      const s = String(char);
      if (s === '\n' || s === '\r' || s === '') process.stdin.removeListener('data', onData);
      else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdin.on('data', onData);
  }
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); }));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const username = args.username || await ask('사용자명: ');
  const password = args.password || await ask('비밀번호: ', { hidden: true });

  if (!username || !password) {
    console.error('사용자명과 비밀번호가 필요합니다.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('비밀번호는 8자 이상이어야 합니다.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const store = createUserStore(config);
  const record = await store.upsert({ username, passwordHash, roles: ['admin'] });
  console.log(`사용자 "${record.username}" 저장 완료 → ${config.usersFile}`);
})().catch((err) => { console.error(err.message); process.exit(1); });
