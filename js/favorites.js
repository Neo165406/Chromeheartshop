 // js/favorites.js
// Shared favorites (wishlist) logic for fashion1sta — localStorage-backed
// so it persists across pages without a backend.

const FAV_KEY = 'fashion1sta_favorites';

export function getFavorites(){
  try{ return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
  catch(e){ return []; }
}
function saveFavorites(favs){
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}
export function isFavorite(id){
  return getFavorites().some(f=>f.id===id);
}
export function toggleFavorite(item){
  const favs = getFavorites();
  const idx = favs.findIndex(f=>f.id===item.id);
  if(idx > -1){
    favs.splice(idx,1);
    saveFavorites(favs);
    return false; // now not favorited
  }
  favs.push(item);
  saveFavorites(favs);
  return true; // now favorited
}
export function removeFavorite(id){
  saveFavorites(getFavorites().filter(f=>f.id!==id));
}

function heartIcon(filled){
  return `<svg viewBox="0 0 24 24" fill="${filled?'currentColor':'none'}" stroke="currentColor" stroke-width="1.7"><path d="M12 20s-8-5-8-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-8 11-8 11z"/></svg>`;
}

// Wires up "[data-fav-btn]" heart buttons inside a container via event
// delegation, so it works for cards rendered after Firestore data loads.
// Each button needs data-id, data-name, data-price, data-image.
export function wireFavButtons(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.addEventListener('click', (e)=>{
    const btn = e.target.closest('.fav-btn');
    if(!btn) return;
    e.preventDefault();
    const nowFav = toggleFavorite({
      id: btn.dataset.id,
      name: btn.dataset.name,
      price: Number(btn.dataset.price),
      imageUrl: btn.dataset.image || null
    });
    btn.classList.toggle('active', nowFav);
    btn.innerHTML = heartIcon(nowFav);
  });
}

// Sets the correct filled/outline state for every [data-fav-btn] heart
// inside a container after it's rendered (call once after cards are added).
export function refreshFavButtons(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.querySelectorAll('.fav-btn').forEach(btn=>{
    const fav = isFavorite(btn.dataset.id);
    btn.classList.toggle('active', fav);
    btn.innerHTML = heartIcon(fav);
  });
}
