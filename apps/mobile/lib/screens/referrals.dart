import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

class ReferralsScreen extends StatefulWidget {
  const ReferralsScreen({super.key});
  @override State<ReferralsScreen> createState() => _ReferralsScreenState();
}
class _ReferralsScreenState extends State<ReferralsScreen> {
  List<Map<String,dynamic>> _items=[];
  bool _loading=true; String? _error;
  @override void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final items=asMapList(await api.getData('/api/referrals/mine')); if (mounted) setState(() { _items=items; _loading=false; _error=null; }); }
    on ApiException catch(e) { if(mounted) setState(() { _error=e.message; _loading=false; }); }
    catch(_) { if(mounted) setState(() { _error='دریافت کمپین‌ها ناموفق بود. اتصال و نسخه سرور را بررسی کنید.'; _loading=false; }); }
  }
  Future<void> _issue(String id) async {
    try { await api.postData('/api/referrals/mine/$id/link'); await _load(); }
    on ApiException catch(e) { if(mounted) showSnack(context,e.message,error:true); }
    catch(_) { if(mounted) showSnack(context,'ساخت لینک انجام نشد.',error:true); }
  }
  @override Widget build(BuildContext context) => Scaffold(
    appBar:AppBar(title:const Text('دعوت دوستان')),
    body:_loading ? const Center(child:CircularProgressIndicator()) : _error!=null ? Center(child:Column(mainAxisSize:MainAxisSize.min,children:[Text(_error!),TextButton(onPressed:_load,child:const Text('تلاش دوباره'))])) : RefreshIndicator(onRefresh:_load,child:ListView(padding:const EdgeInsets.all(16),children:[
      const Text('با ثبت‌نام دوستان جدید و تأیید موبایل آنها، تا پیش از تکمیل ظرفیت و طبق شرایط هر کمپین پاداش کیف پول دریافت کنید.',style:TextStyle(height:1.8)),
      if(_items.isEmpty) const Padding(padding:EdgeInsets.all(24),child:Text('کمپینی فعال نیست.',textAlign:TextAlign.center)),
      for(final item in _items) Padding(padding:const EdgeInsets.only(top:12),child:SoftCard(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(asStr(item['title']),style:const TextStyle(fontWeight:FontWeight.bold)), const SizedBox(height:8),
        Text('با ${faDigits(item['threshold'])} ثبت‌نام تأییدشده، یک‌بار ${faMoney(asNum(item['rewardAmount']))} هدیه در صورت باقی‌ماندن ظرفیت. پیشرفت: ${faDigits(item['qualified'])} از ${faDigits(item['threshold'])}',style:const TextStyle(height:1.8)),
        Text(asBool(item['rewarded'])?'پاداش پرداخت شده است':asBool(item['accepting'])?'کمپین فعال':'کمپین متوقف یا ظرفیت تکمیل شده است'),
        if(asStr(item['token']).isEmpty) FilledButton(onPressed:asBool(item['accepting'])?()=>_issue(asStr(item['id'])):null,child:const Text('ساخت لینک دعوت'))
        else ...[
          const SizedBox(height:8),
          SelectableText('${SessionStore.instance.serverUrl}/invite/${asStr(item['token'])}',textDirection:TextDirection.ltr,style:const TextStyle(fontSize:12)),
          TextButton.icon(onPressed:() async { await Clipboard.setData(ClipboardData(text:'${SessionStore.instance.serverUrl}/invite/${asStr(item['token'])}')); if(context.mounted) showSnack(context,'لینک دعوت کپی شد.'); },icon:const Icon(Icons.copy_rounded),label:const Text('کپی لینک دعوت')),
          const Text('لینک باید از شبکه و آدرس قابل دسترس دوست شما باز شود.',style:TextStyle(fontSize:11)),
        ]
      ]))),
    ])),
  );
}
