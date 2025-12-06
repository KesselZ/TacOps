#!/usr/bin/env node

/**
 * 从 Git commit 历史自动生成更新日志
 * 使用方法: node scripts/generate-changelog.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 获取 Git commit 历史
function getGitCommits(sinceDate = '2025-11-01') {
    try {
        const output = execSync(
            `git log --oneline --since="${sinceDate}" --pretty=format:"%h|%s|%ad" --date=short`,
            { encoding: 'utf8', cwd: path.resolve(__dirname, '..') }
        );
        
        return output.trim().split('\n').map(line => {
            const [hash, ...messageParts] = line.split('|');
            const message = messageParts.slice(0, -1).join('|'); // 重新组合消息部分
            const date = messageParts[messageParts.length - 1];
            
            return { hash, message: message.trim(), date };
        });
    } catch (error) {
        console.error('获取 Git 历史失败:', error.message);
        return [];
    }
}

// 将 commits 按版本分组
function groupByVersion(commits) {
    const versions = [];
    let currentVersion = null;
    
    for (const commit of commits) {
        // 检测版本标记 (v1.2.0, v13, v15.1 等)
        const versionMatch = commit.message.match(/^(v\d+(?:\.\d+)*(?:\.\d+)?)/);
        
        if (versionMatch) {
            // 新版本开始
            const version = versionMatch[1];
            const title = commit.message.replace(version, '').trim() || '版本更新';
            
            currentVersion = {
                version,
                date: commit.date,
                title,
                changes: []
            };
            versions.push(currentVersion);
        } else if (currentVersion) {
            // 添加到当前版本的变更列表
            currentVersion.changes.push(commit.message);
        }
    }
    
    return versions;
}

// 生成更新日志文件
function generateChangelogFile(versions) {
    const content = `// 自动生成的更新日志数据
// 生成时间: ${new Date().toLocaleString('zh-CN')}
// 请勿手动编辑此文件，使用 'node scripts/generate-changelog.js' 重新生成

export const CHANGELOG_DATA = ${JSON.stringify(versions, null, 4)};

// 获取最新版本
export function getLatestVersion() {
    return CHANGELOG_DATA[0]?.version || "未知版本";
}

// 获取更新日志HTML
export function getChangelogHTML() {
    return CHANGELOG_DATA.map(entry => \`
        <div class="changelog-entry">
            <div class="changelog-header">
                <span class="changelog-version">\${entry.version}</span>
                <span class="changelog-date">\${entry.date}</span>
            </div>
            <div class="changelog-title">\${entry.title}</div>
            <ul class="changelog-changes">
                \${entry.changes.map(change => \`<li>\${change}</li>\`).join('')}
            </ul>
        </div>
    \`).join('');
}
`;

    const changelogPath = path.resolve(__dirname, '../data/changelog.js');
    fs.writeFileSync(changelogPath, content, 'utf8');
    console.log(`✅ 更新日志已生成: ${changelogPath}`);
    console.log(`📝 共生成 ${versions.length} 个版本的更新日志`);
}

// 主函数
function main() {
    console.log('🔄 正在从 Git 历史生成更新日志...');
    
    const commits = getGitCommits();
    if (commits.length === 0) {
        console.log('⚠️  没有找到符合条件的 commits');
        return;
    }
    
    console.log(`📋 找到 ${commits.length} 条 commits`);
    
    const versions = groupByVersion(commits);
    if (versions.length === 0) {
        console.log('⚠️  没有找到版本标记的 commits');
        return;
    }
    
    generateChangelogFile(versions);
    
    // 显示预览
    console.log('\n📄 更新日志预览:');
    versions.forEach((version, index) => {
        console.log(\`\n\${index + 1}. \${version.version} (\${version.date}) - \${version.title}\`);
        version.changes.slice(0, 3).forEach(change => {
            console.log(\`   • \${change}\`);
        });
        if (version.changes.length > 3) {
            console.log(\`   • ... 还有 \${version.changes.length - 3} 项变更\`);
        }
    });
}

// 如果直接运行此脚本
if (require.main === module) {
    main();
}

module.exports = { getGitCommits, groupByVersion, generateChangelogFile };
