// pnpm ワークスペース（node-linker=hoisted）で @coto2ba/contracts の TS ソースを
// 直接読ませるための Metro 設定。
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// ワークスペース全体を watch（contracts のソース変更を拾う）
config.watchFolders = [workspaceRoot]

// hoisted linker（pnpm-workspace.yaml の nodeLinker: hoisted）なのでルートを見に行く。
// disableHierarchicalLookup は付けない — .pnpm 配下の解決が壊れる（expo-doctor も警告する）
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// vocab のプレーンテキストを expo-asset で読めるようにする
config.resolver.assetExts = [...config.resolver.assetExts, 'txt']

module.exports = config
