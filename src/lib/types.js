// @ts-check
/** @typedef {{token:string,purpose:string,handle:string,organization:string|null,existing:boolean}} InvitationLink */
/** @typedef {{id:string,label:string,created_at:number}} Credential */
/** @typedef {{user: import("../../worker/types.js").User,organizations: import("../../worker/types.js").Organization[],credentials:Credential[]}} Me */
/** @typedef {{object:string,id:string,name:string,created_at:string}} Domain */
/** @typedef {{id:string,name:string,prefix:string,permission:string,domain_id:string|null,created_at:number}} Key */
/** @typedef {{id:string,handle:string,role:"owner"|"admin"|"member"}} Member */
/** @typedef {{id:string,handle:string,role:string,expires_at:number}} Invitation */
/** @typedef {{id:string,from:string,to:string[],cc:string[],bcc:string[],reply_to:string[],subject:string,created_at:string,message_id:string,html?:string|null,text?:string|null,tags:{name:string,value:string}[],attachments:{filename:string,content_type:string}[],cdfsend:{status:string,error:{message:string}|null}}} Email */
/** @template T @typedef {{data:T[],has_more:boolean}} Page */
export {};
