// Retired campaign compatibility endpoint: old clients receive no assignment.
import {NextResponse} from 'next/server'
import {verifyToken} from '@/lib/auth-guard'
export const runtime='edge'
async function authorized(request,userId){
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
 const user=await verifyToken(token);return user&&user.id===userId
}
export async function GET(request){
 try{
 const userId=new URL(request.url).searchParams.get('userId')
 if(!userId||!await authorized(request,userId))return NextResponse.json({error:'Unauthorized'},{status:401})
 return NextResponse.json({success:true,eligible:false,reflectIds:[]},{headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'Unavailable'},{status:503})}
}
export async function POST(request){
 try{
 const body=await request.json()
 if(!body?.userId||!await authorized(request,body.userId))return NextResponse.json({error:'Unauthorized'},{status:401})
 return NextResponse.json({success:true,recorded:false})
 }catch{return NextResponse.json({error:'Unavailable'},{status:503})}
}
