import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const [pid,container,output]=process.argv.slice(2);
if(!/^\d+$/.test(pid)||!container?.includes('/CoreSimulator/Devices/')||!output?.startsWith('/private/tmp/burrow-'))throw Error('Isolated native QA arguments required');
const samples=[];let ticks=0;
const timer=setInterval(()=>{
 try{const [rss,cpu]=execFileSync('ps',['-o','rss=,pcpu=','-p',pid],{encoding:'utf8'}).trim().split(/\s+/).map(Number);
 const report=JSON.parse(fs.readFileSync(container+'/Documents/plushie-touch-native.json','utf8'));
 const phase=report.phases.findIndex((p,i)=>p.frames&&(!report.phases[i+1]?.frames));
 samples.push({at:Date.now(),rssKB:rss,cpuPercent:cpu,phase});
 fs.writeFileSync(output,JSON.stringify({samples,report}));
 if(report.done||++ticks>210){clearInterval(timer);console.log(JSON.stringify({done:report.done,samples:samples.length,output}));}
 }catch(e){if(++ticks>210){clearInterval(timer);console.error(e.message);process.exitCode=1;}}
},2000);
