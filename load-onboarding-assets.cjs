const fs=require('node:fs'),path=require('node:path');
module.exports=()=>{
 const file=path.join(__dirname,'assets/onboarding/frog-feature-actions.webp'),data=fs.readFileSync(file);
 if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP')throw Error('Invalid frog onboarding artwork: '+file);
 return 'data:image/webp;base64,'+data.toString('base64');
};
