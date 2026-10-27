import { Linking, Platform } from 'react-native';
import { presentOfferCodeRedemption } from './iap';
import { appAlert } from '@/components/ui/app-dialog';
let opening = false;
export async function openOfficialRedeemCode() {
    if (opening)
        return;
    opening = true;
    try {
        if (Platform.OS === 'ios')
            await presentOfferCodeRedemption();
        else if (Platform.OS === 'android')
            await Linking.openURL('https://play.google.com/redeem');
        else
            appAlert('Redeem Code', 'Redeem your code in the App Store or Google Play on your phone.');
    }
    catch {
        appAlert('Could not open Redeem Code', 'Please try again, or redeem your code directly in your app store.');
    }
    finally {
        opening = false;
    }
}
