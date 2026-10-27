const path=require('node:path');
const rows=require('../docs/tap-your-day-391-source.json');
const artRoot=path.resolve(__dirname,'../apps/mobile/assets/Tap-your-day-Icons');
const sourceById=new Map(rows.map(row=>[row.itemId,row]));
const assetFor=id=>path.join(artRoot,sourceById.get(id).asset);
module.exports={rows,artRoot,sourceById,assetFor};
