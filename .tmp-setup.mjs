import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const MAIN="http://127.0.0.1:3001";
const conn=new Connection("http://localhost:8899","confirmed");
const adminKp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`,"utf8"))));
const O={Origin:"http://localhost:3001"};

async function api(path,{method="GET",token,body}={}){
  const h={...O}; if(token) h.authorization=`Bearer ${token}`;
  let payload; if(body!==undefined){payload=JSON.stringify(body); h["content-type"]="application/json";}
  const res=await fetch(`${MAIN}${path}`,{method,headers:h,body:payload});
  const text=await res.text(); let j; try{j=JSON.parse(text);}catch{j=text;}
  return {code:res.status,j};
}
async function signSend(txB64){
  const tx=Transaction.from(Buffer.from(txB64,"base64"));
  tx.sign(adminKp);
  const sig=await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig,"confirmed");
  return String(sig);
}

// admin 登录
let r=await api("/api/auth/login",{method:"POST",body:{email:"admin@supply-chain.io",password:"Admin123!"}});
const at=r.j?.accessToken;
console.log("admin login:", r.code, !!at);
if(!at) process.exit(1);

// registry init
r=await api("/api/supply-chain/registry/init",{method:"POST",token:at,body:{adminWallet:adminKp.publicKey.toBase58()}});
console.log("registry/init build:", r.code, "registry:", r.j?.registry, "has tx:", !!r.j?.transaction);
if(r.code!==200 && r.code!==201) process.exit(1);
const sig=await signSend(r.j.transaction);
r=await api("/api/supply-chain/registry/init/confirm",{method:"POST",token:at,body:{adminWallet:adminKp.publicKey.toBase58(),txSignature:sig}});
console.log("registry/init confirm:", r.code, JSON.stringify(r.j));
r=await api("/api/supply-chain/registry",{method:"GET",token:at});
console.log("registry status:", r.code, JSON.stringify(r.j));
