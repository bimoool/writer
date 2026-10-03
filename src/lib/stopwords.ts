import { normalize } from './tokens';

/** Предлоги и союзы. Они же допускаются связкой внутри ключевой фразы (SPEC §5 п.5). */
const RU_BRIDGES = `в во на с со к ко по о об обо от до из за для без при про под над у через между перед
  и или а но да либо`;
const EN_BRIDGES = `of in on at for to with by from into over under and or`;

// Встроенные списки стоп-слов (SPEC §5 п.3). Хранятся уже нормализованными (ё → е).
const RU_STOP = `${RU_BRIDGES}
  я ты он она оно мы вы они меня тебя его ее нас вас их мне тебе ему ей нам вам им мной тобой
  ним ней нами вами ими себя себе собой свой своя свое свои своего своей своих своим своими
  мой моя мое мои твой твоя твое твои наш наша наше наши ваш ваша ваше ваши
  этот эта это эти этого этой этих этим этими этом эту тот та то те того той тех тем теми том ту
  такой такая такое такие такого такой таких таким так также тоже
  весь вся все всё всего всей всех всем всеми всему каждый каждая каждое каждые
  который которая которое которые которого которой которых котором которым которыми которую
  кто что какой какая какое какие чей где куда откуда когда зачем почему как сколько
  не ни нет же ли бы вот вон уже еще ещё лишь только даже ведь разве именно вообще
  чтобы что-то кто-то если то есть хотя пока потому поэтому однако зато причем притом
  быть был была было были будет будут буду будем будешь есть являться является являются являлся
  стать становится становятся стал стала стало стали может могут мочь можно нужно надо должен
  должна должно должны очень более менее самый самая самое самые наиболее весьма совсем
  здесь там тут сейчас теперь тогда всегда никогда иногда часто снова опять потом затем
  один одна одно одни два две три много мало несколько
  свою сама сам сами само себе ее её тд тп др т.е т.д т.п
  при этом кроме вместо около среди ради вне сквозь вокруг возле после благодаря согласно
  просто значительно абсолютно внимательно действительно особенно практически достаточно
  важно нужно необходимо возможно конечно например сегодня существует существуют отметить
  помогает помогают позволяет позволяют показывают показывает делать сделать иметь имеет`;

const EN_STOP = `${EN_BRIDGES}
  a an the this that these those is are was were be been being am do does did doing done have has
  had having will would shall should can could may might must i you he she it we they me him her
  us them my your his its our their mine yours ours theirs what which who whom whose when where why
  how all any both each few more most other some such no nor not only own same so than too very
  just also as if then there here about above after again against before below between during
  off out up down further once because while until through own etc e.g i.e`;

const toSet = (s: string) => new Set(s.split(/\s+/).filter(Boolean).map(normalize));

export const STOPWORDS = new Set([...toSet(RU_STOP), ...toSet(EN_STOP)]);
export const BRIDGES = new Set([...toSet(RU_BRIDGES), ...toSet(EN_BRIDGES)]);

export const isStopword = (word: string) => STOPWORDS.has(normalize(word));
export const isBridge = (word: string) => BRIDGES.has(normalize(word));
