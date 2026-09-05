/* Grade 5. */
export const G5_BANKS = {
"g5-express": [
{sec:"P",type:"in",q:"Evaluate: 3 + 4 × 2",ans:11,hint:"Multiply before you add.",
 expl:"Do 4 × 2 = 8 first, then 3 + 8 = 11."},
{sec:"P",type:"in",q:"Evaluate: (5 + 3) × 2",ans:16,expl:"Parentheses first: 5 + 3 = 8, then 8 × 2 = 16."},
{sec:"P",type:"mc",q:"Which expression equals 20?",mono:true,
 opts:["4 × (3 + 2)","4 × 3 + 2","4 + 3 × 2","4 × 3 − 2"],a:0,
 expl:"4 × (3 + 2) = 4 × 5 = 20. The others give 14, 10 and 10."},
{sec:"P",type:"in",q:"Evaluate: 18 − 2 × 5",ans:8,hint:"Multiply before you subtract.",
 expl:"2 × 5 = 10 first, then 18 − 10 = 8."},
{sec:"P",type:"in",q:"Evaluate: (10 − 4) × (3 + 1)",ans:24,
 expl:"Each parenthesis first: 10 − 4 = 6 and 3 + 1 = 4, then 6 × 4 = 24."},
{lvl:2,sec:"P",type:"in",q:"Evaluate: 2 × (6 + 4) − 5",ans:15,
 expl:"6 + 4 = 10, then 2 × 10 = 20, then 20 − 5 = 15."},
{lvl:2,sec:"P",type:"mc",q:"Which expression represents 'add 5 and 3, then double the result'?",mono:true,
 opts:["2 × (5 + 3)","2 × 5 + 3","5 + 3 × 2","(2 × 5) + 3"],a:0,
 expl:"'Then double the result' means the addition happens first, inside parentheses, before multiplying by 2."},
{lvl:3,sec:"P",type:"in",q:"Evaluate: 3 × [(8 − 2) + (5 × 2)]",ans:48,
 hint:"Work the innermost parts first.",
 expl:"8 − 2 = 6 and 5 × 2 = 10, so inside the brackets: 6 + 10 = 16. Then 3 × 16 = 48."}
],

"g5-decops": [
{sec:"D",type:"in",q:"3.4 + 2.8 = ?",ans:6.2,expl:"3.4 + 2.8 = 6.2."},
{sec:"D",type:"in",q:"7.5 − 3.2 = ?",ans:4.3,expl:"7.5 − 3.2 = 4.3."},
{sec:"D",type:"in",q:"0.6 × 5 = ?",ans:3,expl:"0.6 × 5 = 3."},
{sec:"D",type:"mc",q:"Which is 4.25 + 1.5?",opts:["5.75","5.65","4.4","5.25"],a:0,
 expl:"4.25 + 1.50 = 5.75."},
{sec:"D",type:"in",q:"12.6 ÷ 3 = ?",ans:4.2,expl:"12.6 ÷ 3 = 4.2."},
{lvl:2,sec:"D",type:"in",q:"2.35 × 4 = ?",ans:9.4,expl:"2.35 × 4 = 9.4."},
{lvl:2,sec:"D",type:"in",q:"A ribbon is 8.4 m long. It is cut into pieces 1.2 m each. How many pieces are there?",
 ans:7,expl:"8.4 ÷ 1.2 = 7 pieces."},
{lvl:3,sec:"D",type:"in",q:"A runner's three times were 12.45, 11.9 and 12.05 seconds. What is the total time, in seconds?",
 ans:36.4,expl:"12.45 + 11.9 + 12.05 = 36.4 seconds."}
],

"g5-unlike": [
{sec:"F",type:"mc",q:"1/2 + 1/3 = ?",mono:true,opts:["5/6","2/5","1/6","2/6"],a:0,
 expl:"The LCD of 2 and 3 is 6: 3/6 + 2/6 = 5/6."},
{sec:"F",type:"mc",q:"3/4 − 1/6 = ?",mono:true,opts:["7/12","2/12","5/12","1/12"],a:0,
 expl:"The LCD of 4 and 6 is 12: 9/12 − 2/12 = 7/12."},
{sec:"F",type:"mc",q:"Which is the LCD of 1/4 and 1/6?",mono:true,opts:["12","24","10","6"],a:0,
 expl:"The smallest number both 4 and 6 divide into evenly is 12."},
{sec:"F",type:"mc",q:"2/3 + 1/4 = ?",mono:true,opts:["11/12","3/7","9/12","1/12"],a:0,
 expl:"The LCD of 3 and 4 is 12: 8/12 + 3/12 = 11/12."},
{sec:"F",type:"mc",q:"5/6 − 1/2 = ?",mono:true,opts:["1/3","1/6","2/3","1/2"],a:0,
 expl:"The LCD of 6 and 2 is 6: 5/6 − 3/6 = 2/6, which simplifies to 1/3."},
{lvl:2,sec:"F",type:"mc",q:"3/5 + 1/4 = ?",mono:true,opts:["17/20","4/9","13/20","1/20"],a:0,
 expl:"The LCD of 5 and 4 is 20: 12/20 + 5/20 = 17/20."},
{lvl:2,sec:"F",type:"mc",q:"7/8 − 2/3 = ?",mono:true,opts:["5/24","9/24","5/11","1/24"],a:0,
 expl:"The LCD of 8 and 3 is 24: 21/24 − 16/24 = 5/24."},
{lvl:3,sec:"F",type:"mc",q:"1/2 + 1/3 + 1/6 = ?",mono:true,opts:["1","5/6","1/6","2"],a:0,
 expl:"The LCD of 2, 3 and 6 is 6: 3/6 + 2/6 + 1/6 = 6/6, which equals 1 whole."}
]
};
