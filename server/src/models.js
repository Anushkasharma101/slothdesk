import mongoose from 'mongoose';
const {Schema}=mongoose;
export const User=mongoose.model('PublicUser',new Schema({name:String,email:{type:String,unique:true},passwordHash:{type:String,select:false},salt:{type:String,select:false},jobCount:{type:Number,default:0},dailyDigest:{type:Boolean,default:true}},{timestamps:true}));
export const Session=mongoose.model('PublicSession',new Schema({tokenHash:{type:String,unique:true},owner:{type:Schema.Types.ObjectId,ref:'PublicUser',index:true},csrf:String,expiresAt:{type:Date,expires:0}},{timestamps:true}));
const fileSchema=new Schema({id:String,storedName:String,originalPath:String,name:String,size:Number,hash:String,category:String,suggestedName:String,suggestedPath:String,source:String,include:{type:Boolean,default:true},organize:{type:Boolean,default:true}},{_id:false});
export const Job=mongoose.model('PublicJob',new Schema({owner:{type:Schema.Types.ObjectId,ref:'PublicUser',index:true},name:String,state:{type:String,enum:['uploading','ready','deleting'],default:'uploading'},files:[fileSchema],exactGroups:[[String]],similarGroups:[[String]],warnings:[String],mode:String,expiresAt:{type:Date,index:true}},{timestamps:true}));
// Upload records are deleted by cleanup AFTER disk bytes are removed, not a TTL index.
export const Summary=mongoose.model('PublicSummary',new Schema({owner:{type:Schema.Types.ObjectId,ref:'PublicUser'},day:String,text:String,metrics:Schema.Types.Mixed,expiresAt:{type:Date,expires:0}},{timestamps:true}).index({owner:1,day:1},{unique:true}));
export const Slots=mongoose.model('PublicSlots',new Schema({_id:String,value:{type:Number,default:0}}));
