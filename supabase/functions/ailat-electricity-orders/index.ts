import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
const FIREBASE_PROJECT_ID="ailat-data";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ALLOWED_ORIGIN="https://ismailibrahim080699-code.github.io";
const corsHeaders={"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"86400","Vary":"Origin","Content-Type":"application/json"};
const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);
const firebaseKeys=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const discos:Record<number,string>={1:"Ikeja Electricity",2:"Eko Electricity",3:"Kano Electricity",4:"Port Harcourt Electricity",5:"Jos Electricity",6:"Ibadan Electricity",7:"Kaduna Electric",8:"Abuja Electricity",9:"Yola Electricity",10:"Benin Electricity"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:corsHeaders});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
 if(req.method!=="POST")return reply({success:false,error:"Method not allowed"},405);
 if(!SUPABASE_URL||!SERVICE_ROLE_KEY)return reply({success:false,error:"Backend configuration error"},500);
 const auth=req.headers.get("Authorization")??"";
 const token=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!token)return reply({success:false,error:"Login required"},401);
 let userId:string;
 try{
  const {payload}=await jwtVerify(token,firebaseKeys,{issuer:`https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,audience:FIREBASE_PROJECT_ID});
  if(typeof payload.sub!=="string"||!payload.sub)return reply({success:false,error:"Invalid account"},401);
  if(payload.email_verified!==true)return reply({success:false,error:"Verified email required"},403);
  userId=payload.sub;
 }catch{return reply({success:false,error:"Invalid or expired login session"},401);}
 try{
  const raw=await req.text();if(raw.length>8192)return reply({success:false,error:"Request too large"},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return reply({success:false,error:"Invalid JSON"},400);}
  const key=body.idempotency_key,data=body.customer_data;
  if(typeof key!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))return reply({success:false,error:"A valid request key is required"},400);
  if(!data||typeof data!=="object"||Array.isArray(data))return reply({success:false,error:"Invalid meter details"},400);
  const d=data as Record<string,unknown>,disco=Number(d.disco),meterType=String(d.meter_type??""),meter=String(d.meter_number??"").trim(),amount=Number(d.amount);
  if(!Number.isInteger(disco)||!Object.prototype.hasOwnProperty.call(discos,disco))return reply({success:false,error:"Choose a valid electricity company"},400);
  if(!["prepaid","postpaid"].includes(meterType))return reply({success:false,error:"Choose prepaid or postpaid"},400);
  if(!/^\\d{6,20}$/.test(meter))return reply({success:false,error:"Enter a valid meter number"},400);
  if(!Number.isSafeInteger(amount)||amount<100||amount>1000000)return reply({success:false,error:"Amount must be between ₦100 and ₦1,000,000"},400);
  const clean={disco,disco_name:discos[disco],meter_type:meterType,meter_number:meter,amount};
  const reference=`AIL-EL-${crypto.randomUUID().replaceAll("-","").slice(0,12).toUpperCase()}`;
  const {data:inserted,error}=await supabase.from("service_order_requests").insert({user_id:userId,reference,idempotency_key:key,service_key:"electricity",requested_amount:amount,currency:"NGN",customer_data:clean,provider_dispatch_status:"disabled_safe_mode",provider_request_id:null,provider_request_preview:null,status:"received"}).select("id,reference,service_key,requested_amount,currency,status,created_at").single();
  if(error?.code==="23505"){
   const {data:existing,error:lookupError}=await supabase.from("service_order_requests").select("id,reference,service_key,requested_amount,currency,status,customer_data,created_at").eq("user_id",userId).eq("idempotency_key",key).maybeSingle();
   if(lookupError)throw lookupError;
   if(existing){
    const old=(existing.customer_data??{}) as Record<string,unknown>;
    const same=existing.service_key==="electricity"&&Number(existing.requested_amount)===amount&&Number(old.disco)===disco&&old.meter_type===meterType&&old.meter_number===meter&&Number(old.amount)===amount;
    if(!same)return reply({success:false,error:"This request key was already used for different electricity details. Start a new request."},409);
    return reply({success:true,order_request:{id:existing.id,reference:existing.reference,service_key:existing.service_key,requested_amount:existing.requested_amount,currency:existing.currency,status:existing.status,created_at:existing.created_at},repeated_request:true,notice:"Request recorded by AILAT DATA only. No provider was contacted, no payment was taken and no token was issued."});
   }
  }
  if(error)throw error;
  return reply({success:true,order_request:inserted,repeated_request:false,notice:"Request recorded by AILAT DATA only. No provider was contacted, no payment was taken and no token was issued."},201);
 }catch(error){
  console.error("AILAT ELECTRICITY REQUEST ERROR:",error instanceof Error?error.message:"Unknown error");
  return reply({success:false,error:"Could not record the electricity request. Please try again."},500);
 }
});
