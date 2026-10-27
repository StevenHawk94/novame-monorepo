import sharp from 'sharp'

/** Decode, strip metadata and re-encode; MIME or magic bytes alone are not proof. */
export async function normalizeProfileAvatar(bytes) {
  if(!bytes?.length || bytes.length>5*1024*1024)throw Error('invalid_image')
  const input=sharp(bytes,{limitInputPixels:16777216,failOn:'warning',animated:false})
  const metadata=await input.metadata()
  if(!['jpeg','png','webp'].includes(metadata.format) || !metadata.width || !metadata.height
    || metadata.width>4096 || metadata.height>4096 || (metadata.pages??1)>1)throw Error('invalid_image')
  const output=await input.rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true})
    .flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true}).toBuffer()
  if(output.length>1024*1024)throw Error('invalid_image')
  return output
}
