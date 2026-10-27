export const RELATIONSHIP_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export type RelationshipDateParts={year:number;month:number;day:number};
export function localRelationshipDate(date=new Date()):RelationshipDateParts{
  return {year:date.getFullYear(),month:date.getMonth()+1,day:date.getDate()};
}
export function relationshipMonthDays(year:number,month:number){return new Date(year,month,0).getDate();}
export function clampRelationshipDate(value:RelationshipDateParts,today=localRelationshipDate()):RelationshipDateParts{
  const year=Math.max(1900,Math.min(today.year,value.year));
  const month=Math.max(1,Math.min(year===today.year?today.month:12,value.month));
  const day=Math.max(1,Math.min(year===today.year&&month===today.month?today.day:relationshipMonthDays(year,month),value.day));
  return {year,month,day};
}
export function formatRelationshipDate(value:RelationshipDateParts){
  return `${String(value.day).padStart(2,'0')}/${String(value.month).padStart(2,'0')}/${value.year}`;
}
export function parseRelationshipDate(value:string,today=localRelationshipDate()):string|null{
  const parts=value.trim().replace(/[./-]/g,' ').split(/\s+/).map(Number);
  if(parts.length!==3||parts.some(part=>!Number.isInteger(part)))return null;
  const [day,month,year]=parts,clamped=clampRelationshipDate({year,month,day},today);
  if(year!==clamped.year||month!==clamped.month||day!==clamped.day)return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function relationshipDateParts(value:string,today=localRelationshipDate()):RelationshipDateParts{
  if(!parseRelationshipDate(value,today))return today;
  const [day,month,year]=value.trim().replace(/[./-]/g,' ').split(/\s+/).map(Number);
  return {year,month,day};
}
