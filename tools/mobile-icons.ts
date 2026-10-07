import { deflateSync } from "node:zlib";

/** Rasterize the viewer's simple V mark locally; no remote asset or image service. */
export function mobileIcon(size:number):Buffer {
  const points=[[137,150],[195,150],[256,319],[317,150],[375,150],[278,377],[234,377]];
  const pixels=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=(x+.5)*512/size,py=(y+.5)*512/size;let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++)if((points[i][1]>py)!==(points[j][1]>py)&&px<(points[j][0]-points[i][0])*(py-points[i][1])/(points[j][1]-points[i][1])+points[i][0])inside=!inside;
    const offset=y*(size*4+1)+1+x*4;pixels[offset]=inside?255:35;pixels[offset+1]=inside?255:61;pixels[offset+2]=inside?255:123;pixels[offset+3]=255;
  }
  const chunk=(type:string,data:Buffer)=>{
    const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
    for(const byte of content){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,content,tail]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
}
