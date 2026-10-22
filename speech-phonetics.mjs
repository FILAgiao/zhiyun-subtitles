import {pinyin} from 'pinyin-pro';
// Bundled dictionary only: matching never sends text to a transliteration service.
const options={toneType:'none',type:'array',nonZh:'consecutive',v:true};
export function syllables(text){return pinyin(String(text||''),options);}
export function readings(character){return pinyin(String(character||''),{...options,multiple:true});}
