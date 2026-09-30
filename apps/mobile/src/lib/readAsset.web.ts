export async function readAsset(asset: { uri: string; file?: File }): Promise<ArrayBuffer> {
  if (asset.file) return await asset.file.arrayBuffer();
  return await (await fetch(asset.uri)).arrayBuffer();
}
