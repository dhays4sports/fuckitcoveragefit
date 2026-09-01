(function(root){
  'use strict';
  const D='coveragefit_pvx_discovery_v1',B='coveragefit_pvx_branch_answers_v1',S='coveragefit_pvx_snapshot_v1';
  const read=key=>{try{return JSON.parse(root.localStorage.getItem(key)||'null');}catch(_){return null;}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function install(){
    if(!root.document?.body?.hasAttribute('data-pvx-snapshot'))return;
    const discovery=read(D)||{answers:{},exactCustomerWords:{}},branches=read(B)||{};
    const topics=root.CoverageFitPVXReviewTopicEngine.derive(discovery,branches),model=root.CoverageFitPVXSnapshotModel.derive(discovery,topics),$=id=>document.getElementById(id);
    const surface=model.signalSurface||{topicCount:model.whatDylanWouldLookAtFirst.length,countLabel:'Your Snapshot is ready.',primaryTopic:model.whatDylanWouldLookAtFirst[0]||null};
    try{root.localStorage.setItem(S,JSON.stringify(model));}catch(_){}
    $('pvxSnapshotCount').textContent=surface.countLabel;
    $('pvxTriggerShort').textContent=model.triggerNarrative?.shortForm||model.whyNowThread?.headline||'A personal reason to take a closer look';
    $('pvxTriggerLong').textContent=model.triggerNarrative?.longForm||'';
    if(surface.primaryTopic){$('pvxSnapshotPrimaryLabel').textContent=surface.primaryTopic.label;$('pvxSnapshotPrimaryBecause').textContent=surface.primaryTopic.becauseYouToldUs||'';}
    else{$('pvxSnapshotPrimary').hidden=true;document.querySelector('.pvx-snapshot-primary-action').textContent='Review what you shared';document.querySelector('.pvx-snapshot-primary-action').href='#pvxSnapshotContent';}
    $('pvxSnapshotWhy').textContent=model.whyNowThread?.headline||model.whyReviewing?.label||'You are taking a thoughtful first look.';
    $('pvxSnapshotImprove').innerHTML=model.wantsToImprove.map(item=>`<span>${esc(item.label)}</span>`).join('')||'<span>Still deciding</span>';
    const context=model.coverageContext||model.homeContext||[];
    const contextTitle=$('pvxSnapshotContextTitle');if(contextTitle)contextTitle.textContent=model.contextHeading||'What you told us';
    $('pvxSnapshotHome').innerHTML=context.map(item=>`<span>${esc(item.label)}</span>`).join('')||'<span>No extra context yet</span>';
    $('pvxSnapshotImportant').innerHTML=model.whatSeemsImportant.map(item=>`<li>${esc(item)}</li>`).join('')||'<li>Keeping the review simple and relevant</li>';
    $('pvxSnapshotTopics').innerHTML=model.whatDylanWouldLookAtFirst.map(topic=>`<article class="pvx-snapshot-topic"><span>Worth reviewing</span><h3>${esc(topic.label)}</h3><p>${esc(topic.becauseYouToldUs)}</p></article>`).join('');
    $('pvxSnapshotEmpty').hidden=model.whatDylanWouldLookAtFirst.length>0;
    const connection=$('pvxTriggerTopicConnection');connection.textContent=model.triggerNarrative?.topicConnection||'';connection.hidden=!model.triggerNarrative?.topicConnection;
    try{root.dispatchEvent(new CustomEvent('coveragefit:pvx-snapshot-result-viewed',{detail:{revision:'1',productTrack:model.productTrack,topicCount:surface.topicCount,entryClass:'pvx',renderState:'complete'}}));}catch(_){}
    try{root.dispatchEvent(new CustomEvent('coveragefit:pvx-snapshot-viewed',{detail:{revision:'1',productTrack:model.productTrack,topicCount:surface.topicCount,anonymous:true,contactRequired:false,scoreCreated:false}}));}catch(_){}
  }
  root.addEventListener('DOMContentLoaded',install,{once:true});
})(window);
