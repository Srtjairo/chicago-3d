// Offline-only readers. Raw feeds stay in the ignored, dated cache.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
export const cache=new URL('../.cache/transit/2026-10-29/',import.meta.url);
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export async function source(name,url){
  await mkdir(cache,{recursive:true});const file=new URL(name,cache);
  let bytes;try{bytes=await readFile(file);}catch{
    const r=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`${url}: ${r.status}`);
    bytes=Buffer.from(await r.arrayBuffer());await writeFile(file,bytes);
    await writeFile(new URL(name+'.source.json',cache),JSON.stringify({url,sha256:sha256(bytes),lastModified:r.headers.get('last-modified'),retrievedAt:new Date().toISOString()},null,2));
  }
  const meta=JSON.parse(await readFile(new URL(name+'.source.json',cache),'utf8'));if(meta.sha256!==sha256(bytes))throw Error('Cached source hash mismatch: '+name);
  const lock=JSON.parse(await readFile(new URL('./transit-sources.lock.json',import.meta.url),'utf8')).find(s=>s.name===name);
  if(!lock||lock.sha256!==meta.sha256)throw Error('Source differs from the October 29 snapshot: '+name+'. Restore the dated cache; do not silently replace the pinned feed.');return {bytes,meta};
}
export function zipReader(zip){
  let end=-1;for(let p=zip.length-22;p>=Math.max(0,zip.length-65558);p--)if(zip.readUInt32LE(p)===0x06054b50){end=p;break;}
  if(end<0)throw Error('Invalid CTA ZIP');let p=zip.readUInt32LE(end+16);const files=new Map();
  while(zip.readUInt32LE(p)===0x02014b50){const n=zip.readUInt16LE(p+28),e=zip.readUInt16LE(p+30),c=zip.readUInt16LE(p+32);
    files.set(zip.subarray(p+46,p+46+n).toString(),{method:zip.readUInt16LE(p+10),size:zip.readUInt32LE(p+20),offset:zip.readUInt32LE(p+42)});p+=46+n+e+c;}
  return name=>{const e=files.get(name);if(!e)return '';const o=e.offset+30+zip.readUInt16LE(e.offset+26)+zip.readUInt16LE(e.offset+28),b=zip.subarray(o,o+e.size);return (e.method===8?inflateRawSync(b):b).toString('utf8');};
}
export function* csv(text){
  let row=[],v='',quoted=false,header=null;
  for(let i=0;i<=text.length;i++){const c=text[i]??'\n';
    if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===','||c==='\n')){row.push(v.replace(/\r$/,''));v='';if(c==='\n'){if(!header)header=row;else if(row.length===header.length)yield Object.fromEntries(header.map((k,j)=>[k,row[j]]));row=[];}}
    else v+=c;
  }
}
