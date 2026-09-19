"use strict";
function resolveIdentity(request){
  const user=request.headers["x-authenticated-user"];
  if(!user)throw new Error("trusted proxy identity required");
  return {user};
}
function adminPanel(request){return {message:"hello "+resolveIdentity(request).user}}
function health(){return {ok:true}}
module.exports={resolveIdentity,adminPanel,health};
