#!/usr/bin/env node
'use strict';
/*
 * shared/api-contract.js 와 web/index.html에 인라인된 계약 블록이
 * 동일한지 검증한다. (web은 빌드 없이 단일 파일이어야 하므로 인라인 복사본 사용)
 */
const fs = require('fs');
const path = require('path');

const BEGIN = '/* ===== GEO ADMIN SHARED CONTRACT BEGIN ===== */';
const END = '/* ===== GEO ADMIN SHARED CONTRACT END ===== */';

function extract(text, file) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0) {
    console.error(`${file}: 계약 마커를 찾을 수 없습니다.`);
    process.exit(1);
  }
  return text.slice(start + BEGIN.length, end).trim();
}

const root = path.join(__dirname, '..', '..');
const shared = extract(fs.readFileSync(path.join(root, 'shared', 'api-contract.js'), 'utf8'), 'shared/api-contract.js');
const inlined = extract(fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'), 'web/index.html');

if (shared === inlined) {
  console.log('OK: shared/api-contract.js 와 web/index.html 인라인 블록이 일치합니다.');
} else {
  console.error('불일치: web/index.html의 인라인 계약 블록을 shared/api-contract.js 내용으로 갱신하세요.');
  process.exit(1);
}
