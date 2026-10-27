const {load}=require('./lifecycle-test-utils.cjs');
function sceneHarness(){
  const calls=[],gradients=[],paths=[];
  const canvas={scale:(...v)=>calls.push(['scale',...v]),translate:(...v)=>calls.push(['translate',...v]),
    drawPicture:p=>calls.push(['warm-picture',p]),drawCircle:(...v)=>calls.push(['circle',...v]),drawPath:(...v)=>calls.push(['path',...v])};
  let picture;
  const Skia={Color:c=>c,Paint:()=>({setShader(){}}),
    Shader:{MakeRadialGradient:(center,radius,colors,positions,mode)=>{const s={center,radius,colors,positions,mode};gradients.push(s);return s;}},
    Path:{Make(){const path={moves:[],moveTo:(...v)=>path.moves.push(v),lineTo(){},close(){}};paths.push(path);return path;}},
    PictureRecorder:()=>({beginRecording:bounds=>{calls.push(['record',bounds]);return canvas;},finishRecordingAsPicture:()=>picture={id:calls.length}}),
    Surface:{MakeOffscreen:(...size)=>{calls.push(['surface',...size]);return{getCanvas:()=>canvas,flush:()=>calls.push(['flush']),dispose:()=>calls.push(['dispose'])};}},
  };
  const api=load('apps/mobile/src/lib/adventure-sunburst-scene.ts',{'@shopify/react-native-skia':{Skia,TileMode:{Clamp:'clamp'}},
    './adventure-reward-motion':load('apps/mobile/src/lib/adventure-reward-motion.ts')});
  return {api,calls,gradients,paths,Skia};
}
module.exports={sceneHarness};
