#!/usr/bin/env node

import fs from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const REPO_OWNER = 'atlaspetco';
const REPO_NAME = 'APC-planner';

async function uploadFile(filePath, content) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  
  // Get current file SHA if it exists
  let sha = null;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      sha = data.sha;
    }
  } catch (e) {
    // File doesn't exist, will create new
  }

  const body = {
    message: `Update ${filePath} - Square badge design implementation`,
    content: Buffer.from(content).toString('base64'),
    ...(sha && { sha })
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (response.ok) {
    console.log(`✅ Uploaded: ${filePath}`);
  } else {
    console.error(`❌ Failed to upload ${filePath}:`, await response.text());
  }
}

async function syncKeyFiles() {
  console.log('🚀 Syncing key updated files...');
  
  const keyFiles = [
    'replit.md',
    'client/src/components/dashboard/production-grid.tsx',
    'client/src/components/dashboard/operator-dropdown.tsx'
  ];

  for (const filePath of keyFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        await uploadFile(filePath, content);
      }
    } catch (error) {
      console.error(`Error syncing ${filePath}:`, error.message);
    }
  }

  console.log('✅ GitHub sync completed!');
}

syncKeyFiles().catch(console.error);
