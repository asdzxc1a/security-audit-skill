"use strict";
const docs=[{id:"doc-a",tenantId:"tenant-a",title:"Alpha"},{id:"doc-b",tenantId:"tenant-b",title:"Beta"}];

function getDocument(actor,id){
  const document=docs.find(item=>item.id===id&&item.tenantId===actor.tenantId);
  return document?{...document}:null;
}

function updateDocument(actor,id,title){
  const document=docs.find(item=>item.id===id&&item.tenantId===actor.tenantId);
  if(!document)return null;
  document.title=title;
  return {...document};
}
module.exports={getDocument,updateDocument};
