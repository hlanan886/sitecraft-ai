import{R as d,r as a,a as y}from"./index.DcOvlJY4.js";import{c as b,b as A,j as w,S as M,d as L}from"./utils.Dz576Yxn.js";function B(e){const t=e+"CollectionProvider",[o,n]=b(t),[m,c]=o(t,{collectionRef:{current:null},itemMap:new Map}),C=i=>{const{scope:r,children:f}=i,s=d.useRef(null),l=d.useRef(new Map).current;return w.jsx(m,{scope:r,itemMap:l,collectionRef:s,children:f})};C.displayName=t;const p=e+"CollectionSlot",x=d.forwardRef((i,r)=>{const{scope:f,children:s}=i,l=c(p,f),u=A(r,l.collectionRef);return w.jsx(M,{ref:u,children:s})});x.displayName=p;const R=e+"CollectionItemSlot",I="data-radix-collection-item",S=d.forwardRef((i,r)=>{const{scope:f,children:s,...l}=i,u=d.useRef(null),E=A(r,u),v=c(R,f);return d.useEffect(()=>(v.itemMap.set(u,{ref:u,...l}),()=>void v.itemMap.delete(u))),w.jsx(M,{[I]:"",ref:E,children:s})});S.displayName=R;function h(i){const r=c(e+"CollectionConsumer",i);return d.useCallback(()=>{const s=r.collectionRef.current;if(!s)return[];const l=Array.from(s.querySelectorAll(`[${I}]`));return Array.from(r.itemMap.values()).sort((v,N)=>l.indexOf(v.ref.current)-l.indexOf(N.ref.current))},[r.collectionRef,r.itemMap])}return[{Provider:C,Slot:x,ItemSlot:S},h,n]}var D=y.useId||(()=>{}),O=0;function K(e){const[t,o]=a.useState(D());return L(()=>{o(n=>n??String(O++))},[e]),t?`radix-${t}`:""}var T=a.createContext(void 0);function V(e){const t=a.useContext(T);return e||t||"ltr"}/**
 * @license lucide-react v0.408.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),g=(...e)=>e.filter((t,o,n)=>!!t&&n.indexOf(t)===o).join(" ");/**
 * @license lucide-react v0.408.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var k={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.408.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=a.forwardRef(({color:e="currentColor",size:t=24,strokeWidth:o=2,absoluteStrokeWidth:n,className:m="",children:c,iconNode:C,...p},x)=>a.createElement("svg",{ref:x,...k,width:t,height:t,stroke:e,strokeWidth:n?Number(o)*24/Number(t):o,className:g("lucide",m),...p},[...C.map(([R,I])=>a.createElement(R,I)),...Array.isArray(c)?c:[c]]));/**
 * @license lucide-react v0.408.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=(e,t)=>{const o=a.forwardRef(({className:n,...m},c)=>a.createElement(_,{ref:c,iconNode:t,className:g(`lucide-${j(e)}`,n),...m}));return o.displayName=`${e}`,o};/**
 * @license lucide-react v0.408.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const W=$("ChevronDown",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);export{W as C,V as a,$ as b,B as c,K as u};
