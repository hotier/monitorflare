// ============================================================
// MonitorFlare — 本地开发一次性初始化
//   - 生成 worker/wrangler.toml(从 example 复制,并填入本地随机 D1 id)
//   - 生成 frontend/.env(从 .env.example 复制)
//   - 安装 worker / frontend 依赖(已安装则跳过)
// 幂等:重复执行不会覆盖已存在的文件。
// ============================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function ensureFile(src, dest, transform) {
  const label = dest.replace(root + '\\', '').replace(root + '/', '');
  if (existsSync(dest)) {
    console.log(`  ✓ 已存在,跳过: ${label}`);
    return;
  }
  let content = readFileSync(src, 'utf8');
  if (transform) content = transform(content);
  writeFileSync(dest, content);
  console.log(`  + 已生成: ${label}`);
}

console.log('▶ 生成本地配置文件');
ensureFile(
  join(root, 'worker', 'wrangler.example.toml'),
  join(root, 'worker', 'wrangler.toml'),
  // 本地 wrangler dev 使用本地 D1 模拟,id 只需格式合法即可
  (c) => c.replace('your-d1-database-id-here', randomUUID())
);
ensureFile(join(root, 'frontend', '.env.example'), join(root, 'frontend', '.env'));

console.log('\n▶ 检查依赖');
// 用关键依赖(而非 node_modules 目录)判断是否装全,避免半装状态被误判为已完成
const targets = [
  { dir: 'worker', markers: ['wrangler'] },
  { dir: 'frontend', markers: ['vite'] },
];

const incomplete = [];
for (const { dir, markers } of targets) {
  const pkgDir = join(root, dir);
  const nm = join(pkgDir, 'node_modules');
  // 包目录 + .bin 链接都存在才算安装完成(npm 安装中断时可能只解压了一半)
  const ready =
    markers.every((m) => existsSync(join(nm, m))) && existsSync(join(nm, '.bin'));
  if (ready) {
    console.log(`  ✓ ${dir} 依赖已安装,跳过`);
    continue;
  }
  console.log(`  … 安装 ${dir} 依赖`);
  execSync('npm install', { cwd: pkgDir, stdio: 'inherit' });
  if (!markers.every((m) => existsSync(join(pkgDir, 'node_modules', m)))) incomplete.push(dir);
}

if (incomplete.length) {
  console.error(`\n❌ 依赖安装不完整: ${incomplete.join(', ')}`);
  process.exit(1);
}

console.log('\n✅ 初始化完成,现在运行:npm run dev');
