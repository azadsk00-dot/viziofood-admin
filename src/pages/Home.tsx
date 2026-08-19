import { motion } from 'framer-motion'; import { ArrowDown, ArrowRight, Leaf, Award, Coffee, Heart } from 'lucide-react'; import { Link } from 'react-router-dom'; import hero from '../assets/hero-pasta.png'; import { useRestaurantSettings } from '../hooks/useRestaurantSettings'; import { useHomepagePromo } from '../hooks/useHomepagePromo'; import { useFeaturedDishes } from '../hooks/useFeaturedDishes';
const perks=[['From scratch','Fresh pasta rolled each morning.',Leaf],['Italian at heart','Recipes built on restraint.',Award],['Coffee, properly','A daily roast worth lingering for.',Coffee],['Made for gathering','The table is always open.',Heart]];

const dishPrice=(price:number)=>price%1===0?`$${price}`:`$${price.toFixed(2)}`;

/** Homepage special button — internal paths use the router, anything else opens externally. */
function PromoButton({text,link}:{text:string;link:string}){
  const target=link||'/menu';
  return target.startsWith('/')
    ? <Link className="button" to={target}>{text} <ArrowRight size={17}/></Link>
    : <a className="button" href={target} target="_blank" rel="noreferrer">{text} <ArrowRight size={17}/></a>;
}

export default function Home(){
  const {settings}=useRestaurantSettings();
  const {promo}=useHomepagePromo();
  const {dishes:featured,loading:featuredLoading}=useFeaturedDishes();
  const paused=settings?!settings.ordersEnabled:false;
  const place=settings?.suburb||'Leederville';
  return <main>
    <section className="hero" style={{backgroundImage:`url(${hero})`}}>
      <motion.div initial={{opacity:0,y:30}} animate={{opacity:1,y:0}} transition={{duration:.8}} className="hero-copy">
        <p className="eyebrow">{place} · Since 2014</p>
        <h1>Fresh Italian pasta,<br/><em>made daily.</em></h1>
        <p>Neighbourhood pasta, thoughtful coffee, and the kind of lunch that turns into afternoon.</p>
        <div className="actions">{paused?<span className="button paused" role="status">{settings?.orderPauseMessage||'Online ordering is currently paused.'}</span>:<><Link className="button" to="/checkout">Order now <ArrowRight size={17}/></Link><Link className="textlink" to="/menu">Explore menu</Link></>}</div>
      </motion.div>
      <div className="scroll">Scroll to taste <ArrowDown size={15}/></div>
    </section>
    {promo&&<section className="promo" aria-label="Current special">
      <motion.article initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.6}} className="promo-card">
        {promo.imageUrl&&<div className="promo-art" style={{backgroundImage:`url(${promo.imageUrl})`}} role="img" aria-label={promo.title}/>}
        <div className="promo-copy">
          <p className="eyebrow">{promo.promoType==='daily'?'Special of the day':'Special of the week'}</p>
          <h2>{promo.title}</h2>
          {promo.description&&<p>{promo.description}</p>}
          <div className="promo-actions">
            {promo.price!=null&&<b>{dishPrice(promo.price)}</b>}
            {promo.buttonText&&<PromoButton text={promo.buttonText} link={promo.buttonLink}/>}
          </div>
        </div>
      </motion.article>
    </section>}
    <section className="section featured">
      <div className="split">
        <div><p className="eyebrow">A little of everything</p><h2>Worth coming<br/>back for.</h2></div>
        <Link className="textlink" to="/menu">View full menu <ArrowRight size={16}/></Link>
      </div>
      {featuredLoading?null:featured.length>0
        ? <div className="dish-grid">{featured.map((d,i)=><motion.article whileHover={{y:-8}} key={d.id} className={'dish d'+i}>
            <div className="food-art" style={d.imageUrl?{backgroundImage:`url(${d.imageUrl})`}:undefined}/>
            <h3>{d.name}</h3>
            <p>{d.description}</p>
            <b>{dishPrice(d.price)}</b>
          </motion.article>)}</div>
        : <p className="featured-empty">Featured dishes are coming soon.</p>}
    </section>
    <section className="why"><div><p className="eyebrow">Our little philosophy</p><h2>Simple food,<br/><em>extraordinary care.</em></h2></div><div className="perks">{perks.map(([t,d,Icon]:any)=><article key={t}><Icon/><h3>{t}</h3><p>{d}</p></article>)}</div></section>
    <section className="coffee"><div><p className="eyebrow">Coffee before anything</p><h2>Slow mornings,<br/>excellent coffee.</h2><p>Our baristas pull every shot with the same care we bring to the kitchen.</p><Link to="/menu" className="button light">Meet the coffee bar <ArrowRight size={17}/></Link></div><div className="coffee-cup">V<br/><i>f</i></div></section>
    <section className="section quotes"><p className="eyebrow">From our regulars</p><h2>“The pasta is spectacular,<br/>but the feeling is even better.”</h2><p>— Maya L., Leederville</p></section>
    <section className="cta"><p className="eyebrow">Bring your appetite</p><h2>Make tonight<br/><em>delicious.</em></h2>{paused?<span className="button paused" role="status">Online ordering is currently paused.</span>:<Link className="button" to="/checkout">Order pasta <ArrowRight size={17}/></Link>}</section>
  </main>;
}
